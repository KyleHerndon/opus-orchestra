/**
 * vsock Proxy - HTTP/HTTPS proxy for Cloud Hypervisor VMs
 *
 * Listens on a Unix socket (host side of vsock) and forwards
 * HTTP/HTTPS requests to the internet, with optional domain filtering.
 *
 * This allows VMs to have network access without TAP devices,
 * iptables, or sudo. The VM just needs HTTP_PROXY/HTTPS_PROXY set.
 */

import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs';
import { URL } from 'url';

export interface ProxyConfig {
    /** Unix socket path to listen on (host side of vsock) */
    socketPath: string;
    /** Allowed domains. Empty array or undefined = block all. Use ['*'] for allow all. */
    allowedDomains?: string[];
    /** Allow all traffic (overrides allowedDomains) */
    allowAllTraffic?: boolean;
    /** Optional callback for logging */
    onLog?: (message: string) => void;
}

/**
 * Check if a hostname matches the allowed domains list.
 */
function isDomainAllowed(hostname: string, config: ProxyConfig): boolean {
    if (config.allowAllTraffic) {
        return true;
    }

    const allowed = config.allowedDomains || [];

    if (allowed.length === 0) {
        return false;
    }

    if (allowed.includes('*')) {
        return true;
    }

    // Check exact match or subdomain match
    const lowerHostname = hostname.toLowerCase();
    for (const domain of allowed) {
        const lowerDomain = domain.toLowerCase();
        if (lowerHostname === lowerDomain) {
            return true;
        }
        // Allow subdomains: "github.com" allows "api.github.com"
        if (lowerHostname.endsWith('.' + lowerDomain)) {
            return true;
        }
    }

    return false;
}

/**
 * Create and start the vsock proxy server.
 */
export function createProxy(config: ProxyConfig): http.Server {
    const log = config.onLog || (() => {});

    const server = http.createServer((req, res) => {
        // Handle regular HTTP requests
        const url = req.url || '/';
        let targetUrl: URL;

        try {
            // HTTP proxy requests have full URL
            if (url.startsWith('http://')) {
                targetUrl = new URL(url);
            } else {
                // Shouldn't happen for proxy requests, but handle it
                const host = req.headers.host || 'localhost';
                targetUrl = new URL(`http://${host}${url}`);
            }
        } catch (e) {
            log(`Invalid URL: ${url}`);
            res.writeHead(400);
            res.end('Bad Request');
            return;
        }

        const hostname = targetUrl.hostname;

        if (!isDomainAllowed(hostname, config)) {
            log(`Blocked: ${hostname}`);
            res.writeHead(403);
            res.end(`Domain not allowed: ${hostname}`);
            return;
        }

        log(`HTTP: ${req.method} ${targetUrl.href}`);

        // Forward the request
        const proxyReq = http.request({
            hostname: targetUrl.hostname,
            port: targetUrl.port || 80,
            path: targetUrl.pathname + targetUrl.search,
            method: req.method,
            headers: req.headers,
        }, (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
            proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
            log(`HTTP error: ${err.message}`);
            res.writeHead(502);
            res.end(`Proxy error: ${err.message}`);
        });

        req.pipe(proxyReq);
    });

    // Handle HTTPS CONNECT tunneling
    server.on('connect', (req, clientSocket, head) => {
        const [hostname, port] = (req.url || '').split(':');
        const targetPort = parseInt(port, 10) || 443;

        if (!isDomainAllowed(hostname, config)) {
            log(`Blocked CONNECT: ${hostname}`);
            clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            clientSocket.end();
            return;
        }

        log(`CONNECT: ${hostname}:${targetPort}`);

        // Create tunnel to target
        const serverSocket = net.connect(targetPort, hostname, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

            if (head && head.length > 0) {
                serverSocket.write(head);
            }

            // Pipe data bidirectionally
            serverSocket.pipe(clientSocket);
            clientSocket.pipe(serverSocket);
        });

        serverSocket.on('error', (err) => {
            log(`CONNECT error to ${hostname}: ${err.message}`);
            clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            clientSocket.end();
        });

        clientSocket.on('error', (err) => {
            log(`Client socket error: ${err.message}`);
            serverSocket.destroy();
        });
    });

    // Clean up existing socket file
    if (fs.existsSync(config.socketPath)) {
        fs.unlinkSync(config.socketPath);
    }

    server.listen(config.socketPath, () => {
        log(`Proxy listening on ${config.socketPath}`);
        // Make socket accessible
        fs.chmodSync(config.socketPath, 0o666);
    });

    return server;
}

/**
 * ProxyManager - manages proxy instances for multiple VMs
 */
export class ProxyManager {
    private proxies = new Map<string, http.Server>();
    private logCallback?: (vmId: string, message: string) => void;

    constructor(onLog?: (vmId: string, message: string) => void) {
        this.logCallback = onLog;
    }

    /**
     * Start a proxy for a VM.
     */
    start(vmId: string, socketPath: string, allowedDomains?: string[], allowAllTraffic?: boolean): void {
        if (this.proxies.has(vmId)) {
            this.stop(vmId);
        }

        const proxy = createProxy({
            socketPath,
            allowedDomains,
            allowAllTraffic,
            onLog: (msg) => this.logCallback?.(vmId, msg),
        });

        this.proxies.set(vmId, proxy);
    }

    /**
     * Stop a proxy for a VM.
     */
    stop(vmId: string): void {
        const proxy = this.proxies.get(vmId);
        if (proxy) {
            proxy.close();
            this.proxies.delete(vmId);
        }
    }

    /**
     * Stop all proxies.
     */
    stopAll(): void {
        for (const [vmId] of this.proxies) {
            this.stop(vmId);
        }
    }
}
