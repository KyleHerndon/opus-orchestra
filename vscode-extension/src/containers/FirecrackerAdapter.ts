/**
 * Firecracker microVM adapter implementation.
 * Manages Firecracker VMs via the Firecracker REST API.
 *
 * Firecracker VMs provide stronger isolation than containers:
 * - Separate kernel instance
 * - Hardware virtualization (KVM)
 * - Minimal attack surface (~50k lines of Rust)
 *
 * Requirements:
 * - Linux host with KVM enabled (/dev/kvm)
 * - Firecracker binary installed
 * - Kernel image (vmlinux)
 * - Root filesystem image (ext4)
 * - vsock kernel module for host-guest communication
 */

import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import { execSync, spawn, ChildProcess } from 'child_process';
import { agentPath, getHomeDir } from '../pathUtils';
import { ContainerAdapter, ContainerDisplayInfo } from './ContainerAdapter';
import { getLogger, isLoggerInitialized, getConfigService } from '../services';

/**
 * Kernel configuration for Firecracker VM.
 */
interface KernelConfig {
    path: string;           // Path to vmlinux kernel (e.g., ~/.opus-orchestra/firecracker/vmlinux-5.10)
    bootArgs?: string;      // Kernel boot arguments
}

/**
 * Root filesystem configuration.
 */
interface RootfsConfig {
    path: string;           // Path to ext4 root filesystem image
    readOnly?: boolean;     // Mount read-only (default: false)
}

/**
 * Network configuration for Firecracker VM.
 */
interface NetworkConfig {
    mode: 'none' | 'tap';
    tapDevice?: string;         // TAP device name (e.g., fc-tap0)
    hostDevName?: string;       // Interface name inside guest (e.g., eth0)
    guestMac?: string;          // MAC address for guest
    allowAllTraffic?: boolean;  // Allow all outbound traffic
    allowedDomains?: string[];  // Restrict to specific domains (requires proxy)
}

/**
 * vsock configuration for host-guest communication.
 * vsock provides efficient VM sockets without network stack overhead.
 */
interface VsockConfig {
    enabled: boolean;
    cid: number;    // Context ID (must be unique per VM, >= 3)
    port: number;   // Port for command agent
}

/**
 * Additional drive to mount in the VM.
 */
interface DriveConfig {
    id: string;
    path: string;           // Host path (relative to worktree or absolute)
    readOnly: boolean;
    mountPoint: string;     // Mount point inside guest
}

/**
 * Firecracker VM definition file format.
 */
export interface FirecrackerDefinition {
    name: string;
    description?: string;
    kernel: KernelConfig;
    rootfs: RootfsConfig;
    memoryMB: number;               // Memory in MB
    vcpuCount: number;              // Number of vCPUs
    network?: NetworkConfig;
    vsock?: VsockConfig;
    drives?: DriveConfig[];
    environment?: Record<string, string>;
}

/**
 * Firecracker API configuration structure.
 * This matches what Firecracker expects via its REST API.
 * Reserved for future use when implementing full Firecracker API support.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface FirecrackerConfig {
    'boot-source': {
        kernel_image_path: string;
        boot_args?: string;
    };
    'drives': Array<{
        drive_id: string;
        path_on_host: string;
        is_root_device: boolean;
        is_read_only: boolean;
    }>;
    'machine-config': {
        vcpu_count: number;
        mem_size_mib: number;
    };
    'network-interfaces'?: Array<{
        iface_id: string;
        guest_mac?: string;
        host_dev_name: string;
    }>;
    'vsock'?: {
        guest_cid: number;
        uds_path: string;
    };
}

/**
 * Tracks a running Firecracker VM.
 */
interface RunningVM {
    process: ChildProcess;
    socketPath: string;
    vsockPath?: string;
    definition: FirecrackerDefinition;
    worktreePath: string;
    agentId: number;
}

export class FirecrackerAdapter implements ContainerAdapter {
    readonly type = 'firecracker';

    // Map from containerId (vm-{agentId}) to running VM info
    private runningVMs = new Map<string, RunningVM>();

    private debugLog(message: string): void {
        if (isLoggerInitialized()) {
            getLogger().child('FirecrackerAdapter').debug(message);
        }
    }

    private errorLog(message: string): void {
        if (isLoggerInitialized()) {
            getLogger().child('FirecrackerAdapter').error(message);
        }
    }

    /**
     * Check if Firecracker is available on this system.
     * Requires:
     * - Firecracker binary
     * - KVM support (/dev/kvm)
     * - Linux host
     */
    async isAvailable(): Promise<boolean> {
        try {
            // Check for firecracker binary
            const firecrackerPath = getConfigService().firecrackerPath || 'firecracker';
            execSync(`which ${firecrackerPath}`, { stdio: 'ignore', timeout: 5000 });

            // Check for KVM support
            if (!fs.existsSync('/dev/kvm')) {
                this.debugLog('KVM not available (/dev/kvm missing)');
                return false;
            }

            // Check KVM is accessible
            try {
                fs.accessSync('/dev/kvm', fs.constants.R_OK | fs.constants.W_OK);
            } catch {
                this.debugLog('KVM not accessible (check permissions on /dev/kvm)');
                return false;
            }

            return true;
        } catch {
            return false;
        }
    }

    /**
     * Read display info from a Firecracker definition file.
     */
    async getDisplayInfo(definitionPath: string): Promise<ContainerDisplayInfo> {
        const definition = this.loadDefinition(definitionPath);
        return {
            name: definition.name,
            description: definition.description,
            memoryLimit: `${definition.memoryMB}MB`,
            cpuLimit: `${definition.vcpuCount} vCPU`,
        };
    }

    /**
     * Create and start a Firecracker VM.
     */
    async create(definitionPath: string, worktreePath: string, agentId: number): Promise<string> {
        const definition = this.loadDefinition(definitionPath);
        const containerId = `fc-vm-${agentId}`;

        this.debugLog(`Creating Firecracker VM ${containerId}`);
        this.debugLog(`Definition: ${JSON.stringify(definition, null, 2)}`);

        // Resolve paths
        const kernelPath = this.resolvePath(definition.kernel.path);
        const rootfsPath = this.resolvePath(definition.rootfs.path);

        // Validate kernel and rootfs exist
        if (!fs.existsSync(kernelPath)) {
            throw new Error(
                `Firecracker kernel not found: ${definition.kernel.path}\n` +
                `Expected at: ${kernelPath}\n` +
                `Download a kernel with: ./scripts/setup/firecracker-kernel.sh`
            );
        }

        if (!fs.existsSync(rootfsPath)) {
            throw new Error(
                `Firecracker rootfs not found: ${definition.rootfs.path}\n` +
                `Expected at: ${rootfsPath}\n` +
                `Create a rootfs with: ./scripts/setup/firecracker-rootfs.sh`
            );
        }

        // Create runtime directory for this VM
        const runtimeDir = `/tmp/firecracker-${containerId}`;
        if (!fs.existsSync(runtimeDir)) {
            fs.mkdirSync(runtimeDir, { recursive: true });
        }

        const socketPath = `${runtimeDir}/firecracker.socket`;
        const vsockPath = definition.vsock?.enabled ? `${runtimeDir}/vsock.socket` : undefined;

        // Clean up any existing socket
        if (fs.existsSync(socketPath)) {
            fs.unlinkSync(socketPath);
        }

        // Set up TAP device if network is configured
        if (definition.network?.mode === 'tap' && definition.network.tapDevice) {
            await this.setupTapDevice(definition.network, containerId);
        }

        // Start Firecracker process
        const firecrackerPath = getConfigService().firecrackerPath || 'firecracker';
        const fcProcess = spawn(firecrackerPath, [
            '--api-sock', socketPath,
            '--id', containerId,
        ], {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
        });

        fcProcess.stdout?.on('data', (data) => {
            this.debugLog(`FC stdout: ${data}`);
        });

        fcProcess.stderr?.on('data', (data) => {
            this.debugLog(`FC stderr: ${data}`);
        });

        fcProcess.on('error', (err) => {
            this.errorLog(`Firecracker process error: ${err}`);
        });

        // Wait for socket to be available
        await this.waitForSocket(socketPath, 5000);

        // Configure the VM via REST API
        await this.configureVM(socketPath, definition, kernelPath, rootfsPath, worktreePath, vsockPath);

        // Start the VM
        await this.apiRequest(socketPath, 'PUT', '/actions', {
            action_type: 'InstanceStart',
        });

        // Track the running VM
        this.runningVMs.set(containerId, {
            process: fcProcess,
            socketPath,
            vsockPath,
            definition,
            worktreePath,
            agentId,
        });

        this.debugLog(`Firecracker VM ${containerId} started`);
        return containerId;
    }

    /**
     * Execute a command in the Firecracker VM via vsock.
     */
    async exec(containerId: string, command: string): Promise<string> {
        const vm = this.runningVMs.get(containerId);
        if (!vm) {
            throw new Error(`VM not found: ${containerId}`);
        }

        if (!vm.vsockPath || !vm.definition.vsock?.enabled) {
            throw new Error(
                `vsock not enabled for VM ${containerId}. ` +
                `Add vsock configuration to the definition file.`
            );
        }

        this.debugLog(`Exec in VM ${containerId}: ${command}`);

        // Connect to vsock agent in the VM
        return new Promise((resolve, reject) => {
            const socket = net.createConnection(vm.vsockPath!, () => {
                // Send command as JSON
                const request = JSON.stringify({
                    type: 'exec',
                    command,
                    env: vm.definition.environment,
                });
                socket.write(request + '\n');
            });

            let data = '';
            socket.on('data', (chunk) => {
                data += chunk.toString();
            });

            socket.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    if (response.error) {
                        reject(new Error(response.error));
                    } else {
                        resolve(response.output || '');
                    }
                } catch {
                    resolve(data);
                }
            });

            socket.on('error', (err) => {
                reject(new Error(`vsock connection failed: ${err.message}`));
            });

            socket.setTimeout(60000, () => {
                socket.destroy();
                reject(new Error('Command execution timed out'));
            });
        });
    }

    /**
     * Destroy a Firecracker VM.
     */
    async destroy(containerId: string): Promise<void> {
        const vm = this.runningVMs.get(containerId);
        if (!vm) {
            this.debugLog(`VM ${containerId} not found, may already be destroyed`);
            return;
        }

        this.debugLog(`Destroying Firecracker VM: ${containerId}`);

        try {
            // Send SendCtrlAltDel to gracefully shutdown
            await this.apiRequest(vm.socketPath, 'PUT', '/actions', {
                action_type: 'SendCtrlAltDel',
            });

            // Wait a bit for graceful shutdown
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch {
            // Ignore errors, we'll force kill anyway
        }

        // Kill the process
        if (vm.process && !vm.process.killed) {
            vm.process.kill('SIGKILL');
        }

        // Clean up TAP device
        if (vm.definition.network?.mode === 'tap' && vm.definition.network.tapDevice) {
            try {
                execSync(`sudo ip link delete ${vm.definition.network.tapDevice}`, { stdio: 'ignore' });
            } catch {
                // TAP device may already be gone
            }
        }

        // Clean up runtime directory
        const runtimeDir = `/tmp/firecracker-${containerId}`;
        if (fs.existsSync(runtimeDir)) {
            fs.rmSync(runtimeDir, { recursive: true, force: true });
        }

        this.runningVMs.delete(containerId);
        this.debugLog(`VM ${containerId} destroyed`);
    }

    /**
     * Get resource usage stats for a Firecracker VM.
     */
    async getStats(containerId: string): Promise<{ memoryMB: number; cpuPercent: number } | null> {
        const vm = this.runningVMs.get(containerId);
        if (!vm || !vm.process.pid) {
            return null;
        }

        try {
            // Get process stats from /proc
            const statFile = `/proc/${vm.process.pid}/stat`;
            if (!fs.existsSync(statFile)) {
                return null;
            }

            const stat = fs.readFileSync(statFile, 'utf8').split(' ');
            const rss = parseInt(stat[23], 10) * 4096 / (1024 * 1024); // Convert pages to MB

            // CPU usage would require sampling over time, return 0 for now
            return {
                memoryMB: Math.round(rss),
                cpuPercent: 0,
            };
        } catch {
            return null;
        }
    }

    // ==================== Private helpers ====================

    /**
     * Load and parse a firecracker definition file.
     */
    private loadDefinition(definitionPath: string): FirecrackerDefinition {
        const nodePath = agentPath(definitionPath).forNodeFs();

        if (!fs.existsSync(nodePath)) {
            throw new Error(`Firecracker definition file not found: ${definitionPath}`);
        }

        try {
            const content = fs.readFileSync(nodePath, 'utf8');
            return JSON.parse(content) as FirecrackerDefinition;
        } catch (e) {
            throw new Error(`Failed to parse firecracker definition: ${e}`);
        }
    }

    /**
     * Resolve a path that may contain ~ or be relative.
     */
    private resolvePath(inputPath: string): string {
        if (inputPath.startsWith('~/')) {
            const homeDir = getHomeDir().forNodeFs();
            return inputPath.replace('~/', homeDir + '/');
        }
        return agentPath(inputPath).forNodeFs();
    }

    /**
     * Wait for the Firecracker API socket to be available.
     */
    private async waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            if (fs.existsSync(socketPath)) {
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error(`Firecracker socket not available after ${timeoutMs}ms`);
    }

    /**
     * Configure the VM via Firecracker REST API.
     */
    private async configureVM(
        socketPath: string,
        definition: FirecrackerDefinition,
        kernelPath: string,
        rootfsPath: string,
        worktreePath: string,
        vsockPath?: string,
    ): Promise<void> {
        // Configure boot source
        await this.apiRequest(socketPath, 'PUT', '/boot-source', {
            kernel_image_path: kernelPath,
            boot_args: definition.kernel.bootArgs || 'console=ttyS0 reboot=k panic=1 pci=off',
        });

        // Configure machine (memory, vCPUs)
        await this.apiRequest(socketPath, 'PUT', '/machine-config', {
            vcpu_count: definition.vcpuCount,
            mem_size_mib: definition.memoryMB,
        });

        // Configure root drive
        await this.apiRequest(socketPath, 'PUT', '/drives/rootfs', {
            drive_id: 'rootfs',
            path_on_host: rootfsPath,
            is_root_device: true,
            is_read_only: definition.rootfs.readOnly || false,
        });

        // Configure additional drives (for workspace mounting)
        // Note: Firecracker uses virtio-blk, so the guest needs to mount these
        // A better approach might be virtiofs (requires newer kernel) or 9p
        if (definition.drives) {
            for (const drive of definition.drives) {
                const drivePath = drive.path === './'
                    ? worktreePath
                    : this.resolvePath(drive.path);

                // For directory mounts, we'd need to create a disk image
                // or use virtiofs. For now, log a warning.
                this.debugLog(
                    `Drive ${drive.id} points to ${drivePath}. ` +
                    `Directory mounting requires virtiofs or creating a disk image.`
                );
            }
        }

        // Configure network
        if (definition.network?.mode === 'tap' && definition.network.tapDevice) {
            await this.apiRequest(socketPath, 'PUT', '/network-interfaces/eth0', {
                iface_id: 'eth0',
                guest_mac: definition.network.guestMac || 'AA:FC:00:00:00:01',
                host_dev_name: definition.network.tapDevice,
            });
        }

        // Configure vsock
        if (definition.vsock?.enabled && vsockPath) {
            await this.apiRequest(socketPath, 'PUT', '/vsock', {
                guest_cid: definition.vsock.cid,
                uds_path: vsockPath,
            });
        }
    }

    /**
     * Set up TAP device for network access.
     */
    private async setupTapDevice(network: NetworkConfig, _vmId: string): Promise<void> {
        const tapDevice = network.tapDevice!;

        try {
            // Create TAP device
            execSync(`sudo ip tuntap add dev ${tapDevice} mode tap`, { stdio: 'ignore' });
            execSync(`sudo ip addr add 172.16.0.1/24 dev ${tapDevice}`, { stdio: 'ignore' });
            execSync(`sudo ip link set ${tapDevice} up`, { stdio: 'ignore' });

            // Enable IP forwarding
            execSync('sudo sysctl -w net.ipv4.ip_forward=1', { stdio: 'ignore' });

            // Set up NAT (masquerading)
            execSync(`sudo iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE`, { stdio: 'ignore' });
            execSync(`sudo iptables -A FORWARD -i ${tapDevice} -o eth0 -j ACCEPT`, { stdio: 'ignore' });
            execSync(`sudo iptables -A FORWARD -i eth0 -o ${tapDevice} -m state --state RELATED,ESTABLISHED -j ACCEPT`, { stdio: 'ignore' });

            // If domain filtering is enabled, we'd need to set up a DNS proxy
            // For now, just allow all traffic if allowAllTraffic is true
            if (!network.allowAllTraffic && network.allowedDomains?.length) {
                this.debugLog(
                    `Domain filtering requested but not yet implemented. ` +
                    `Allowing all traffic for now.`
                );
            }
        } catch (e) {
            throw new Error(`Failed to set up TAP device: ${e}`);
        }
    }

    /**
     * Make a request to the Firecracker API via Unix socket.
     */
    private apiRequest(
        socketPath: string,
        method: string,
        path: string,
        body?: object,
    ): Promise<object> {
        return new Promise((resolve, reject) => {
            const bodyStr = body ? JSON.stringify(body) : '';

            const options: http.RequestOptions = {
                socketPath,
                path,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr),
                },
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(data ? JSON.parse(data) : {});
                        } catch {
                            resolve({});
                        }
                    } else {
                        reject(new Error(`Firecracker API error: ${res.statusCode} ${data}`));
                    }
                });
            });

            req.on('error', reject);
            req.write(bodyStr);
            req.end();
        });
    }
}
