/**
 * Cloud Hypervisor adapter with virtio-fs support.
 *
 * Key features:
 * - Uses virtio-fs for fast, live file mounting from host to guest
 * - Configuration via CLI args
 * - vsock for host-guest communication and network proxy
 *
 * Requirements:
 * - Linux with KVM (/dev/kvm)
 * - cloud-hypervisor binary
 * - virtiofsd binary (for virtio-fs mounts)
 * - Kernel with virtio-fs support
 */

import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import { exec, execSync, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { agentPath, getHomeDir } from '../pathUtils';
import { ContainerAdapter, ContainerDisplayInfo } from './ContainerAdapter';
import { getLogger, isLoggerInitialized, getConfigService } from '../services';
import { ProxyManager } from './vsockProxy';

const execAsync = promisify(exec);

/**
 * Mount configuration for virtio-fs.
 */
export interface VirtioFsMount {
    /** Tag used to identify this mount in the guest */
    tag: string;
    /** Path on host to share */
    hostPath: string;
    /** Mount point in guest */
    guestPath: string;
    /** Read-only mount (default: false) */
    readOnly?: boolean;
}

/**
 * Cloud Hypervisor VM definition.
 */
export interface CloudHypervisorDefinition {
    name: string;
    description?: string;

    /** Path to kernel (default: ~/.opus-orchestra/cloud-hypervisor/vmlinux) */
    kernelPath?: string;
    /** Kernel boot arguments */
    kernelBootArgs?: string;

    /** Path to rootfs image (default: ~/.opus-orchestra/cloud-hypervisor/rootfs.ext4) */
    rootfsPath?: string;

    /** Memory in MB (default: 4096) */
    memoryMB?: number;
    /** Number of vCPUs (default: 2) */
    vcpuCount?: number;

    /** Run as root in VM (default: true). Set to false to run as 'agent' user */
    runAsRoot?: boolean;

    /** Additional virtio-fs mounts (workspace is always auto-mounted) */
    mounts?: VirtioFsMount[];

    /** Allowed domains for network access */
    allowedDomains?: string[];
    /** Allow all network traffic */
    allowAllTraffic?: boolean;

    /** Environment variables to set in the VM */
    environment?: Record<string, string>;
}

/**
 * Tracks a running virtiofsd process.
 */
interface VirtiofsdProcess {
    process: ChildProcess;
    socketPath: string;
    tag: string;
    guestPath: string;
}

/**
 * Tracks a running Cloud Hypervisor VM.
 */
interface RunningVM {
    process: ChildProcess;
    apiSocketPath: string;
    vsockSocketPath: string;
    proxySocketPath: string;
    tmuxSession: string;
    definition: CloudHypervisorDefinition;
    worktreePath: string;
    agentId: number;
    cid: number;
    sessionId?: string;
    virtiofsdProcesses: VirtiofsdProcess[];
    tapDevice?: string;
    tapIndex?: number;
}

// Global CID counter for vsock (must be >= 3, unique per VM)
let nextCid = 3;

// Network configuration
const CH_BRIDGE = 'chbr0';
const CH_BRIDGE_IP = '192.168.100.1';
const CH_TAP_PREFIX = 'chtap';

export class CloudHypervisorAdapter implements ContainerAdapter {
    readonly type = 'cloud-hypervisor';

    private runningVMs = new Map<string, RunningVM>();

    private proxyManager = new ProxyManager((vmId, msg) => {
        this.debugLog(`[Proxy ${vmId}] ${msg}`);
    });

    private debugLog(message: string): void {
        if (isLoggerInitialized()) {
            getLogger().child('CloudHypervisorAdapter').debug(message);
        }
    }

    private errorLog(message: string): void {
        if (isLoggerInitialized()) {
            getLogger().child('CloudHypervisorAdapter').error(message);
        }
    }

    /**
     * Find an available TAP name (index not in use by running VMs).
     * TAP devices are created dynamically by Cloud Hypervisor.
     */
    private findAvailableTapIndex(): number {
        // Get TAP indices currently in use by running VMs
        const usedIndices = new Set<number>();
        for (const vm of this.runningVMs.values()) {
            if (vm.tapIndex !== undefined) {
                usedIndices.add(vm.tapIndex);
            }
        }

        // Also check for TAP devices that might exist from previous runs
        try {
            const output = execSync('ip link show 2>/dev/null | grep -oE "chtap[0-9]+"', { encoding: 'utf8' });
            for (const match of output.matchAll(/chtap(\d+)/g)) {
                usedIndices.add(parseInt(match[1], 10));
            }
        } catch {
            // No existing TAPs, that's fine
        }

        // Find first available index
        for (let i = 0; i < 1000; i++) {
            if (!usedIndices.has(i)) {
                return i;
            }
        }

        return 0; // Fallback
    }

    /**
     * Check if TAP networking is available.
     * Requires: bridge exists and cloud-hypervisor has CAP_NET_ADMIN
     */
    private isTapNetworkingAvailable(): boolean {
        try {
            // Check if bridge exists
            execSync(`ip link show ${CH_BRIDGE} 2>/dev/null`, { stdio: 'ignore' });

            // Check if cloud-hypervisor has CAP_NET_ADMIN
            const chPath = getConfigService().cloudHypervisorPath || 'cloud-hypervisor';
            const whichOutput = execSync(`which ${chPath}`, { encoding: 'utf8' }).trim();
            const caps = execSync(`getcap ${whichOutput} 2>/dev/null`, { encoding: 'utf8' });
            if (!caps.includes('cap_net_admin')) {
                this.debugLog('cloud-hypervisor missing CAP_NET_ADMIN capability');
                return false;
            }

            return true;
        } catch (e) {
            this.debugLog(`TAP networking not available: ${e}`);
            return false;
        }
    }

    /**
     * Add a TAP device to the bridge after Cloud Hypervisor creates it.
     * Uses sudo with NOPASSWD rules set up by network setup script.
     */
    private async addTapToBridge(tapDevice: string): Promise<void> {
        // Wait for TAP to be created by Cloud Hypervisor
        for (let i = 0; i < 50; i++) {
            try {
                execSync(`ip link show ${tapDevice} 2>/dev/null`, { stdio: 'ignore' });
                break;
            } catch {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        // Add to bridge using sudo (NOPASSWD rule allows this)
        try {
            execSync(`sudo /usr/sbin/ip link set ${tapDevice} master ${CH_BRIDGE}`, { stdio: 'ignore' });
            execSync(`sudo /usr/sbin/ip link set ${tapDevice} up`, { stdio: 'ignore' });
            this.debugLog(`Added ${tapDevice} to bridge ${CH_BRIDGE}`);
        } catch (e) {
            this.debugLog(`Failed to add ${tapDevice} to bridge: ${e}`);
        }
    }

    /**
     * Get VM IP address based on TAP index.
     * Uses 192.168.100.2 + tapIndex (e.g., tap0 -> .2, tap1 -> .3)
     */
    private getVmIpAddress(tapIndex: number): string {
        return `192.168.100.${2 + tapIndex}`;
    }

    /**
     * Check if Cloud Hypervisor is available.
     */
    async isAvailable(): Promise<boolean> {
        try {
            // Check for cloud-hypervisor binary
            const chPath = getConfigService().cloudHypervisorPath || 'cloud-hypervisor';
            await Promise.race([
                execAsync(`which ${chPath}`),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
            ]);

            // Check for KVM
            if (!fs.existsSync('/dev/kvm')) {
                this.debugLog('KVM not available (/dev/kvm missing)');
                return false;
            }

            // Check KVM is accessible
            try {
                fs.accessSync('/dev/kvm', fs.constants.R_OK | fs.constants.W_OK);
            } catch {
                this.debugLog('KVM not accessible (check permissions)');
                return false;
            }

            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get display info from definition file.
     */
    async getDisplayInfo(definitionPath: string): Promise<ContainerDisplayInfo> {
        const definition = this.loadDefinition(definitionPath);
        return {
            name: definition.name,
            description: definition.description,
            memoryLimit: `${definition.memoryMB || 4096}MB`,
            cpuLimit: `${definition.vcpuCount || 2} vCPU`,
        };
    }

    /**
     * Create and start a Cloud Hypervisor VM.
     */
    async create(definitionPath: string, worktreePath: string, agentId: number, sessionId?: string): Promise<string> {
        const definition = this.loadDefinition(definitionPath);
        const containerId = `vm-${agentId}`;

        this.debugLog(`Creating Cloud Hypervisor VM ${containerId}`);
        this.debugLog(`Definition: ${JSON.stringify(definition, null, 2)}`);
        this.debugLog(`Session ID: ${sessionId || 'none'}`);

        // Resolve paths
        const kernelPath = this.resolvePath(
            definition.kernelPath || '~/.opus-orchestra/cloud-hypervisor/vmlinux'
        );
        const rootfsPath = this.resolvePath(
            definition.rootfsPath || '~/.opus-orchestra/cloud-hypervisor/rootfs.ext4'
        );

        // Validate kernel and rootfs
        if (!fs.existsSync(kernelPath)) {
            throw new Error(
                `Cloud Hypervisor kernel not found: ${kernelPath}\n` +
                `Run: ./scripts/setup/cloud-hypervisor.sh`
            );
        }

        if (!fs.existsSync(rootfsPath)) {
            throw new Error(
                `Cloud Hypervisor rootfs not found: ${rootfsPath}\n` +
                `Run: ./scripts/setup/cloud-hypervisor.sh rootfs`
            );
        }

        // Create runtime directory in /tmp (Unix sockets don't work on NTFS)
        // Use containerId which is unique per agent
        const runtimeDir = `/tmp/cloud-hypervisor-${containerId}`;

        // Clean up any existing VM with this ID
        await this.cleanupExistingVM(containerId, runtimeDir);

        if (fs.existsSync(runtimeDir)) {
            fs.rmSync(runtimeDir, { recursive: true, force: true });
        }
        fs.mkdirSync(runtimeDir, { recursive: true });

        const apiSocketPath = `${runtimeDir}/api.socket`;
        const vsockSocketPath = `${runtimeDir}/vsock.socket`;
        const proxySocketPath = `${runtimeDir}/proxy.socket`;
        const tmuxSession = `ch-${containerId}`;

        // Assign unique CID
        const cid = nextCid++;

        // Build list of mounts - workspace is always included
        // Default to root for full permissions, unless runAsRoot is explicitly false
        const runAsRoot = definition.runAsRoot !== false;
        const homeDir = runAsRoot ? '/root' : '/home/agent';
        const workspaceHostPath = agentPath(worktreePath).forNodeFs();

        // Get host's ~/.claude directory for credentials
        const hostClaudeDir = getHomeDir().join('.claude').forNodeFs();

        // Create VM startup script in workspace (so changes don't require rootfs rebuild)
        const vmStartupDir = `${workspaceHostPath}/.opus-orchestra`;
        fs.mkdirSync(vmStartupDir, { recursive: true });
        const vmStartupScript = `${vmStartupDir}/vm-startup.sh`;
        const startupContent = `#!/bin/sh
# VM startup script - sourced by .profile
# Edit this file to change VM behavior without rebuilding rootfs

# Set up oo alias to start Claude with the correct session
${sessionId ? `alias oo="claude --session-id ${sessionId}"` : '# No session ID provided'}

# Print helpful message
echo "Type 'oo' to start Claude Code"
`;
        fs.writeFileSync(vmStartupScript, startupContent);
        fs.chmodSync(vmStartupScript, 0o755);

        const allMounts: VirtioFsMount[] = [
            {
                tag: 'workspace',
                hostPath: workspaceHostPath,
                guestPath: `${homeDir}/workspace`,
                readOnly: false,
            },
            // Mount ~/.claude for credentials and session data (read-write)
            {
                tag: 'claude-config',
                hostPath: hostClaudeDir,
                guestPath: `${homeDir}/.claude`,
                readOnly: false,
            },
            ...(definition.mounts || []),
        ];

        // Start virtiofsd processes for each mount
        const virtiofsdProcesses: VirtiofsdProcess[] = [];
        for (const mount of allMounts) {
            const virtiofsd = await this.startVirtiofsd(containerId, mount, runtimeDir);
            if (virtiofsd) {
                virtiofsdProcesses.push(virtiofsd);
            }
        }

        // Start the proxy for network access (fallback if TAP not available)
        this.proxyManager.start(
            containerId,
            proxySocketPath,
            definition.allowedDomains,
            definition.allowAllTraffic
        );
        this.debugLog(`Started proxy for ${containerId} at ${proxySocketPath}`);

        // Allocate TAP device for networking
        let tapDevice: string | undefined;
        let tapIndex: number | undefined;
        if (this.isTapNetworkingAvailable()) {
            tapIndex = this.findAvailableTapIndex();
            tapDevice = `${CH_TAP_PREFIX}${tapIndex}`;
            this.debugLog(`Will use TAP device ${tapDevice} for ${containerId}`);
        } else {
            this.debugLog(`TAP networking not configured, VM will have no network. Run: scripts/setup/cloud-hypervisor.sh network`);
        }

        // Kill any existing tmux session
        try {
            execSync(`tmux kill-session -t ${tmuxSession} 2>/dev/null`, { stdio: 'ignore' });
        } catch {
            // Session didn't exist
        }

        // Build Cloud Hypervisor command
        const chPath = getConfigService().cloudHypervisorPath || 'cloud-hypervisor';
        const chArgs = this.buildCommandArgs(
            definition,
            kernelPath,
            rootfsPath,
            apiSocketPath,
            vsockSocketPath,
            cid,
            virtiofsdProcesses,
            sessionId,
            tapDevice,
            tapIndex
        );

        const chCommand = `${chPath} ${chArgs.join(' ')}`;
        this.debugLog(`Starting Cloud Hypervisor: ${chCommand}`);

        // Start in tmux session for console access
        // Write command to a script file to avoid shell escaping issues
        const scriptPath = `${runtimeDir}/start.sh`;
        fs.writeFileSync(scriptPath, `#!/bin/bash\n${chCommand}\n`, { mode: 0o755 });

        const tmuxCmd = `tmux new-session -d -s ${tmuxSession} -c ${runtimeDir} ${scriptPath}`;

        try {
            execSync(tmuxCmd, { stdio: 'ignore' });
        } catch (e) {
            // Cleanup virtiofsd processes on failure
            for (const v of virtiofsdProcesses) {
                try { v.process.kill(); } catch { /* ignore */ }
            }
            this.proxyManager.stop(containerId);
            throw new Error(`Failed to start Cloud Hypervisor tmux session: ${e}`);
        }

        // Wait for Cloud Hypervisor to start and create API socket
        this.debugLog('Waiting for Cloud Hypervisor API socket...');
        let chPid: number;
        try {
            // Wait for API socket (indicates CH is running)
            await this.waitForSocket(apiSocketPath, 10000);
            this.debugLog('Cloud Hypervisor API socket ready');

            // Get tmux pane PID
            const pidOutput = execSync(`tmux list-panes -t ${tmuxSession} -F '#{pane_pid}'`, { encoding: 'utf8' });
            chPid = parseInt(pidOutput.trim(), 10);
            this.debugLog(`Cloud Hypervisor tmux session PID: ${chPid}`);

            // Add TAP device to bridge for network connectivity
            if (tapDevice) {
                await this.addTapToBridge(tapDevice);
            }
        } catch (e) {
            // Get error output from tmux session
            let errorDetail = '';
            try {
                errorDetail = execSync(
                    `tmux capture-pane -t ${tmuxSession} -p 2>/dev/null | tail -20`,
                    { encoding: 'utf8', timeout: 2000 }
                );
            } catch {
                // Session might be gone
            }

            // Cleanup on failure
            for (const v of virtiofsdProcesses) {
                try { v.process.kill(); } catch { /* ignore */ }
            }
            this.proxyManager.stop(containerId);
            try {
                execSync(`tmux kill-session -t ${tmuxSession} 2>/dev/null`, { stdio: 'ignore' });
            } catch { /* ignore */ }

            throw new Error(
                `Cloud Hypervisor failed to start.\n` +
                `Command: ${chCommand}\n` +
                `${errorDetail ? `Output:\n${errorDetail}` : `Error: ${e}`}`
            );
        }

        // Create process reference for tracking
        const chProcess = {
            pid: chPid,
            killed: false,
            kill: () => {
                try {
                    execSync(`tmux kill-session -t ${tmuxSession}`, { stdio: 'ignore' });
                } catch {
                    // Ignore
                }
            },
        } as unknown as ChildProcess;

        // Track the VM
        this.runningVMs.set(containerId, {
            process: chProcess,
            apiSocketPath,
            vsockSocketPath,
            proxySocketPath,
            tmuxSession,
            definition,
            worktreePath,
            agentId,
            cid,
            sessionId,
            virtiofsdProcesses,
            tapDevice,
            tapIndex,
        });

        this.debugLog(`Cloud Hypervisor VM ${containerId} started in tmux session ${tmuxSession} (CID: ${cid})`);
        return containerId;
    }

    /**
     * Execute a command in the VM via vsock.
     */
    async exec(containerId: string, command: string): Promise<string> {
        const vm = this.runningVMs.get(containerId);
        if (!vm) {
            throw new Error(`VM not found: ${containerId}`);
        }

        this.debugLog(`Exec in VM ${containerId}: ${command}`);

        return new Promise((resolve, reject) => {
            const socket = net.createConnection(vm.vsockSocketPath, () => {
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
     * Destroy a VM.
     */
    async destroy(containerId: string): Promise<void> {
        const vm = this.runningVMs.get(containerId);
        if (!vm) {
            this.debugLog(`VM ${containerId} not found, may already be destroyed`);
            return;
        }

        this.debugLog(`Destroying Cloud Hypervisor VM: ${containerId}`);

        // Stop proxy
        this.proxyManager.stop(containerId);

        // Try graceful shutdown via API
        try {
            await this.apiRequest(vm.apiSocketPath, 'PUT', '/api/v1/vm.shutdown', {});
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch {
            // Ignore, will force kill
        }

        // Kill tmux session
        try {
            execSync(`tmux kill-session -t ${vm.tmuxSession}`, { stdio: 'ignore' });
        } catch {
            // Already dead
        }

        // Kill virtiofsd processes
        for (const v of vm.virtiofsdProcesses) {
            try {
                v.process.kill('SIGTERM');
            } catch {
                // Already dead
            }
        }

        // Also try direct process kill as backup
        if (vm.process && !vm.process.killed && vm.process.pid) {
            try {
                process.kill(vm.process.pid, 'SIGKILL');
            } catch {
                // Process might already be dead
            }
        }

        // Cleanup runtime directory
        const runtimeDir = `/tmp/cloud-hypervisor-${containerId}`;
        if (fs.existsSync(runtimeDir)) {
            fs.rmSync(runtimeDir, { recursive: true, force: true });
        }

        this.runningVMs.delete(containerId);
        this.debugLog(`VM ${containerId} destroyed`);
    }

    /**
     * Clean up any VM associated with a worktree path.
     * Called when deleting a worktree to ensure VM processes are killed.
     */
    async cleanupByWorktree(worktreePath: string): Promise<void> {
        // Find any tracked VM for this worktree and destroy it
        for (const [containerId, vm] of this.runningVMs) {
            if (vm.worktreePath === worktreePath) {
                this.debugLog(`Found running VM for worktree: ${containerId}`);
                await this.destroy(containerId);
                return;
            }
        }
        this.debugLog(`No tracked VM found for worktree: ${worktreePath}`);
    }

    /**
     * Get VM stats.
     */
    async getStats(containerId: string): Promise<{ memoryMB: number; cpuPercent: number } | null> {
        const vm = this.runningVMs.get(containerId);
        if (!vm || !vm.process.pid) {
            return null;
        }

        try {
            const statFile = `/proc/${vm.process.pid}/stat`;
            if (!fs.existsSync(statFile)) {
                return null;
            }

            const stat = fs.readFileSync(statFile, 'utf8').split(' ');
            const rss = parseInt(stat[23], 10) * 4096 / (1024 * 1024);

            return {
                memoryMB: Math.round(rss),
                cpuPercent: 0,
            };
        } catch {
            return null;
        }
    }

    /**
     * Get shell command for terminal attachment.
     */
    getShellCommand(containerId: string, _worktreePath: string): { shellPath: string; shellArgs?: string[] } | null {
        const vm = this.runningVMs.get(containerId);
        if (!vm) {
            this.debugLog(`getShellCommand: VM ${containerId} not found`);
            return null;
        }

        // Attach to the tmux session running the Cloud Hypervisor VM
        return {
            shellPath: 'tmux',
            shellArgs: ['attach-session', '-t', vm.tmuxSession],
        };
    }

    // ==================== Private helpers ====================

    /**
     * Clean up any existing VM processes for this containerId.
     */
    private async cleanupExistingVM(containerId: string, runtimeDir: string): Promise<void> {
        const tmuxSession = `ch-${containerId}`;

        this.debugLog(`Cleaning up existing VM: ${containerId}`);

        // Kill existing tmux session
        try {
            execSync(`tmux kill-session -t ${tmuxSession} 2>/dev/null`, { stdio: 'ignore' });
            this.debugLog(`Killed existing tmux session: ${tmuxSession}`);
        } catch {
            // Session didn't exist
        }

        if (fs.existsSync(runtimeDir)) {
            // Kill any virtiofsd processes using sockets in this runtime dir
            try {
                execSync(`pkill -f "virtiofsd.*${runtimeDir}" 2>/dev/null`, { stdio: 'ignore' });
            } catch {
                // No processes found
            }

            // Kill any cloud-hypervisor using this API socket
            if (fs.existsSync(`${runtimeDir}/api.socket`)) {
                try {
                    execSync(`pkill -f "cloud-hypervisor.*${runtimeDir}" 2>/dev/null`, { stdio: 'ignore' });
                } catch {
                    // No processes found
                }
            }
        }

        // Small delay to let processes terminate
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    /**
     * Start a virtiofsd process for a mount.
     */
    private async startVirtiofsd(
        containerId: string,
        mount: VirtioFsMount,
        runtimeDir: string
    ): Promise<VirtiofsdProcess | null> {
        const socketPath = `${runtimeDir}/virtiofsd-${mount.tag}.socket`;
        const hostPath = this.resolvePath(mount.hostPath);

        if (!fs.existsSync(hostPath)) {
            this.errorLog(`Mount path does not exist: ${hostPath}`);
            return null;
        }

        this.debugLog(`Starting virtiofsd for ${mount.tag}: ${hostPath} -> ${mount.guestPath}`);

        // Find virtiofsd binary - check standard locations
        const virtiofsdPath = await this.findVirtiofsd();
        if (!virtiofsdPath) {
            this.errorLog('virtiofsd not found - install with: sudo apt install virtiofsd');
            return null;
        }

        try {
            // Rust virtiofsd (apt package) uses --shared-dir syntax
            // --sandbox none: VM provides isolation, avoid newuidmap dependency
            const args = [
                `--socket-path=${socketPath}`,
                `--shared-dir=${hostPath}`,
                `--sandbox=none`,
            ];

            this.debugLog(`virtiofsd command: ${virtiofsdPath} ${args.join(' ')}`);

            // Create log file for virtiofsd errors
            const logPath = `${runtimeDir}/virtiofsd-${mount.tag}.log`;
            const logFd = fs.openSync(logPath, 'w');

            const proc = spawn(virtiofsdPath, args, {
                stdio: ['ignore', logFd, logFd],
                detached: true,
            });

            proc.unref();
            fs.closeSync(logFd);

            // Wait for socket to appear
            try {
                await this.waitForSocket(socketPath, 5000);
            } catch {
                // Check log for error
                let logContent = '';
                try {
                    logContent = fs.readFileSync(logPath, 'utf8');
                } catch { /* ignore */ }

                this.errorLog(`virtiofsd failed for ${mount.tag}: ${logContent || 'socket not created'}`);
                try { proc.kill(); } catch { /* ignore */ }
                return null;
            }

            this.debugLog(`virtiofsd started for ${mount.tag} at ${socketPath}`);

            return {
                process: proc,
                socketPath,
                tag: mount.tag,
                guestPath: mount.guestPath,
            };
        } catch (e) {
            this.errorLog(`Failed to start virtiofsd for ${mount.tag}: ${e}`);
            return null;
        }
    }

    /**
     * Build Cloud Hypervisor command arguments.
     */
    private buildCommandArgs(
        definition: CloudHypervisorDefinition,
        kernelPath: string,
        rootfsPath: string,
        apiSocketPath: string,
        vsockSocketPath: string,
        cid: number,
        virtiofsdProcesses: VirtiofsdProcess[],
        sessionId?: string,
        tapDevice?: string,
        tapIndex?: number
    ): string[] {
        const memoryMB = definition.memoryMB || 4096;
        const vcpuCount = definition.vcpuCount || 2;

        // Build boot args
        let bootArgs = definition.kernelBootArgs ||
            'console=ttyS0 root=/dev/vda rw';

        // Add VM_USER if not running as root (default is root)
        const runAsRoot = definition.runAsRoot !== false;
        if (!runAsRoot) {
            bootArgs += ' VM_USER=agent';
        }

        // Add session ID for Claude auto-start
        if (sessionId) {
            bootArgs += ` CLAUDE_SESSION_ID=${sessionId}`;
        }

        // Add mount info so guest can mount virtio-fs tags
        // Format: VIRTIOFS_MOUNTS=workspace:/home/agent/workspace,tools:/opt/tools
        if (virtiofsdProcesses.length > 0) {
            const mountSpec = virtiofsdProcesses
                .map(v => `${v.tag}:${v.guestPath}`)
                .join(',');
            bootArgs += ` VIRTIOFS_MOUNTS=${mountSpec}`;
        }

        // Add network configuration if TAP is available
        if (tapDevice && tapIndex !== undefined) {
            const vmIp = this.getVmIpAddress(tapIndex);
            bootArgs += ` VM_IP=${vmIp}`;
            bootArgs += ` VM_GATEWAY=${CH_BRIDGE_IP}`;
            bootArgs += ` VM_DNS=8.8.8.8`;
        }

        const args: string[] = [
            '--api-socket', apiSocketPath,
            '--kernel', kernelPath,
            '--cmdline', `"${bootArgs}"`,
            '--cpus', `boot=${vcpuCount}`,
            '--memory', `size=${memoryMB}M,shared=on`,
            '--disk', `path=${rootfsPath}`,
            '--serial', 'tty',
            '--console', 'off',
            '--vsock', `cid=${cid},socket=${vsockSocketPath}`,
        ];

        // Add TAP networking if available
        if (tapDevice) {
            args.push('--net', `tap=${tapDevice}`);
        }

        // Add virtio-fs mounts (single --fs with multiple values, CH doesn't allow multiple --fs args)
        if (virtiofsdProcesses.length > 0) {
            args.push('--fs');
            for (const v of virtiofsdProcesses) {
                args.push(`tag=${v.tag},socket=${v.socketPath},num_queues=1,queue_size=512`);
            }
        }

        return args;
    }

    /**
     * Load definition file.
     */
    private loadDefinition(definitionPath: string): CloudHypervisorDefinition {
        const nodePath = agentPath(definitionPath).forNodeFs();

        if (!fs.existsSync(nodePath)) {
            throw new Error(`Definition file not found: ${definitionPath}`);
        }

        try {
            const content = fs.readFileSync(nodePath, 'utf8');
            return JSON.parse(content) as CloudHypervisorDefinition;
        } catch (e) {
            throw new Error(`Failed to parse definition: ${e}`);
        }
    }

    /**
     * Resolve path with ~ expansion.
     */
    private resolvePath(inputPath: string): string {
        if (inputPath.startsWith('~/')) {
            const homeDir = getHomeDir().forNodeFs();
            return inputPath.replace('~/', homeDir + '/');
        }
        return agentPath(inputPath).forNodeFs();
    }

    /**
     * Find virtiofsd binary in standard locations.
     */
    private async findVirtiofsd(): Promise<string | null> {
        // Check standard locations where virtiofsd might be installed
        const locations = [
            '/usr/libexec/virtiofsd',      // apt package on Ubuntu/Debian
            '/usr/lib/qemu/virtiofsd',     // alternate apt location
            '/usr/local/bin/virtiofsd',    // manual install
        ];

        for (const loc of locations) {
            if (fs.existsSync(loc)) {
                this.debugLog(`Found virtiofsd at ${loc}`);
                return loc;
            }
        }

        // Fall back to PATH lookup
        try {
            const { stdout } = await execAsync('which virtiofsd');
            const path = stdout.trim();
            if (path) {
                this.debugLog(`Found virtiofsd in PATH: ${path}`);
                return path;
            }
        } catch {
            // Not in PATH
        }

        // Check cargo bin
        const homeDir = getHomeDir().forNodeFs();
        const cargoBin = `${homeDir}/.cargo/bin/virtiofsd`;
        if (fs.existsSync(cargoBin)) {
            this.debugLog(`Found virtiofsd at ${cargoBin}`);
            return cargoBin;
        }

        return null;
    }

    /**
     * Wait for a socket file to appear.
     */
    private async waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            if (fs.existsSync(socketPath)) {
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error(`Socket not available after ${timeoutMs}ms: ${socketPath}`);
    }

    /**
     * Make API request to Cloud Hypervisor.
     */
    private apiRequest(
        socketPath: string,
        method: string,
        path: string,
        body?: object
    ): Promise<object> {
        return new Promise((resolve, reject) => {
            const bodyStr = body ? JSON.stringify(body) : '';

            const options = {
                socketPath,
                path,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr),
                },
            };

            const req = http.request(options, (res: http.IncomingMessage) => {
                let data = '';
                res.on('data', (chunk: Buffer) => data += chunk);
                res.on('end', () => {
                    const statusCode = res.statusCode ?? 0;
                    if (statusCode >= 200 && statusCode < 300) {
                        try {
                            resolve(data ? JSON.parse(data) : {});
                        } catch {
                            resolve({});
                        }
                    } else {
                        reject(new Error(`API error: ${statusCode} ${data}`));
                    }
                });
            });

            req.on('error', reject);
            req.write(bodyStr);
            req.end();
        });
    }
}
