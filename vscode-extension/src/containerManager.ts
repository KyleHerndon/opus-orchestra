import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec, execSync, ChildProcess } from 'child_process';
import { agentPath } from './pathUtils';

// Import types from centralized types module
import {
    IsolationTier,
    ContainerState,
    ContainerConfig,
    ContainerInfo,
    PersistedContainerInfo,
} from './types';

// Import services
import {
    getConfigService,
    getEventBus,
    getLogger,
    isLoggerInitialized,
    getPersistenceService,
    isPersistenceServiceInitialized,
} from './services';

// Re-export types for backward compatibility
export { IsolationTier, ContainerState, ContainerConfig, ContainerInfo, PersistedContainerInfo };

/**
 * Labels applied to containers for identification
 */
const CONTAINER_LABELS = {
    managed: 'opus-orchestra.managed=true',
    agentId: (id: number) => `opus-orchestra.agent-id=${id}`,
    worktree: (path: string) => `opus-orchestra.worktree-path=${path}`,
};

/**
 * Default sandbox image
 */
const DEFAULT_IMAGE = 'ghcr.io/kyleherndon/opus-orchestra-sandbox:latest';

/**
 * Paths that are explicitly NOT mounted into containers (credential isolation)
 */
const BLOCKED_HOST_PATHS = [
    '~/.ssh',
    '~/.aws',
    '~/.config/gh',
    '~/.gitconfig',
    '~/.netrc',
    '~/.docker/config.json',
    '~/.kube/config',
];

/**
 * ContainerManager handles lifecycle of isolated agent environments.
 * Supports multiple isolation tiers: sandbox runtime, Docker, gVisor, Firecracker.
 */
export class ContainerManager {
    private containers: Map<number, ContainerInfo> = new Map();
    private extensionPath: string;
    private context: vscode.ExtensionContext | null = null;
    private proxyProcess: ChildProcess | null = null;
    private proxyPort: number = 8377;

    constructor(extensionPath: string) {
        this.extensionPath = extensionPath;
    }

    /**
     * Set extension context for persistence
     */
    setContext(context: vscode.ExtensionContext): void {
        this.context = context;
        this.restoreContainers();
    }

    /**
     * Debug logging via Logger service
     */
    private debugLog(message: string): void {
        if (isLoggerInitialized()) {
            getLogger().child('ContainerManager').debug(message);
        }
    }

    // ========== Tier Availability Checks ==========

    /**
     * Check which isolation tiers are available on this system
     */
    async getAvailableTiers(): Promise<IsolationTier[]> {
        const tiers: IsolationTier[] = ['standard'];  // Always available

        // Check for sandbox-runtime (bubblewrap on Linux, sandbox-exec on macOS)
        if (await this.checkSandboxAvailable()) {
            tiers.push('sandbox');
        }

        // Check for Docker
        if (await this.checkDockerAvailable()) {
            tiers.push('docker');

            // Check for gVisor runtime
            if (await this.checkGvisorAvailable()) {
                tiers.push('gvisor');
            }
        }

        // Check for Firecracker
        if (await this.checkFirecrackerAvailable()) {
            tiers.push('firecracker');
        }

        return tiers;
    }

    private async checkSandboxAvailable(): Promise<boolean> {
        try {
            // Check for bubblewrap on Linux
            execSync('which bwrap', { stdio: 'ignore' });
            return true;
        } catch {
            try {
                // Check for sandbox-exec on macOS
                execSync('which sandbox-exec', { stdio: 'ignore' });
                return true;
            } catch {
                return false;
            }
        }
    }

    private async checkDockerAvailable(): Promise<boolean> {
        try {
            execSync('docker info', { stdio: 'ignore', timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }

    private async checkGvisorAvailable(): Promise<boolean> {
        try {
            // Check if runsc runtime is configured in Docker
            const output = execSync('docker info --format "{{json .Runtimes}}"', {
                encoding: 'utf8',
                timeout: 5000
            });
            return output.includes('runsc');
        } catch {
            return false;
        }
    }

    private async checkFirecrackerAvailable(): Promise<boolean> {
        try {
            const firecrackerPath = getConfigService().firecrackerPath;
            if (!firecrackerPath) {
                return false;
            }
            execSync(`${firecrackerPath} --version`, { stdio: 'ignore', timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }

    // ========== Container Lifecycle ==========

    /**
     * Create an isolated environment for an agent
     */
    async createContainer(
        agentId: number,
        worktreePath: string,
        tier: IsolationTier,
        repoConfig?: ContainerConfig
    ): Promise<ContainerInfo> {
        this.debugLog(`Creating ${tier} container for agent ${agentId}`);

        // Validate tier is available
        const available = await this.getAvailableTiers();
        if (!available.includes(tier)) {
            throw new Error(`Isolation tier '${tier}' is not available on this system`);
        }

        // Check minimum tier requirement from repo config
        if (repoConfig?.minimumTier) {
            const tierOrder: IsolationTier[] = ['standard', 'sandbox', 'docker', 'gvisor', 'firecracker'];
            const minIndex = tierOrder.indexOf(repoConfig.minimumTier);
            const requestedIndex = tierOrder.indexOf(tier);
            if (requestedIndex < minIndex) {
                throw new Error(
                    `Repository requires minimum isolation tier '${repoConfig.minimumTier}', ` +
                    `but '${tier}' was requested`
                );
            }
        }

        let containerId: string;

        switch (tier) {
            case 'standard':
                // No container - just return a placeholder
                containerId = `standard-${agentId}`;
                break;
            case 'sandbox':
                containerId = await this.createSandbox(agentId, worktreePath, repoConfig);
                break;
            case 'docker':
                containerId = await this.createDockerContainer(agentId, worktreePath, repoConfig, false);
                break;
            case 'gvisor':
                containerId = await this.createDockerContainer(agentId, worktreePath, repoConfig, true);
                break;
            case 'firecracker':
                containerId = await this.createFirecrackerVM(agentId, worktreePath, repoConfig);
                break;
            default:
                throw new Error(`Unknown isolation tier: ${tier}`);
        }

        const containerInfo: ContainerInfo = {
            id: containerId,
            tier,
            state: 'running',
            agentId,
            worktreePath,
            proxyPort: tier !== 'standard' ? this.proxyPort : undefined,
            createdAt: new Date(),
        };

        this.containers.set(agentId, containerInfo);
        await this.saveContainers();

        // Emit container created event
        getEventBus().emit('container:created', { containerInfo });

        return containerInfo;
    }

    /**
     * Create a sandbox using sandbox-runtime (bubblewrap/sandbox-exec)
     */
    private async createSandbox(
        agentId: number,
        worktreePath: string,
        config?: ContainerConfig
    ): Promise<string> {
        // TODO: Implement sandbox-runtime integration
        // For now, throw not implemented
        throw new Error('Sandbox runtime not yet implemented. Use Docker tier instead.');
    }

    /**
     * Create a hardened Docker container
     */
    private async createDockerContainer(
        agentId: number,
        worktreePath: string,
        config?: ContainerConfig,
        useGvisor: boolean = false
    ): Promise<string> {
        const appConfig = getConfigService();

        // Determine image
        const image = config?.image || appConfig.containerImage;

        // Resource limits
        const memoryLimit = config?.memoryLimit || appConfig.containerMemoryLimit;
        const cpuLimit = config?.cpuLimit || appConfig.containerCpuLimit;

        // Convert worktree path for Docker (needs to be accessible from Docker daemon)
        const dockerWorktreePath = this.toDockerPath(worktreePath);

        // Build docker run command with security hardening
        const args: string[] = [
            'run',
            '-d',  // Detached
            '--name', `opus-agent-${agentId}`,

            // Labels for identification
            '-l', CONTAINER_LABELS.managed,
            '-l', CONTAINER_LABELS.agentId(agentId),
            '-l', CONTAINER_LABELS.worktree(worktreePath),

            // Security hardening
            '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges',
            '--read-only',

            // Writable temp directories
            '--tmpfs', '/tmp:rw,noexec,nosuid,size=100m',
            '--tmpfs', '/home/agent:rw,noexec,nosuid,size=500m',

            // Network isolation - use none and communicate via unix socket
            '--network', 'none',

            // Resource limits
            '--memory', memoryLimit,
            '--cpus', cpuLimit,
            '--pids-limit', '100',

            // Run as non-root
            '--user', '1000:1000',

            // Mount worktree
            '-v', `${dockerWorktreePath}:/workspace:rw`,

            // Mount proxy socket (created by proxy service)
            // '-v', '/var/run/opus-proxy.sock:/var/run/proxy.sock:ro',
        ];

        // Use gVisor runtime if requested
        if (useGvisor) {
            args.push('--runtime', 'runsc');
        }

        // Add additional mounts from config (read-only by default)
        if (config?.additionalMounts) {
            for (const mount of config.additionalMounts) {
                const sourcePath = this.toDockerPath(
                    path.isAbsolute(mount.source)
                        ? mount.source
                        : path.join(worktreePath, mount.source)
                );
                const mode = mount.readonly !== false ? 'ro' : 'rw';
                args.push('-v', `${sourcePath}:${mount.target}:${mode}`);
            }
        }

        // Add environment variables
        if (config?.environment) {
            for (const [key, value] of Object.entries(config.environment)) {
                args.push('-e', `${key}=${value}`);
            }
        }

        // Add image and command (sleep infinity to keep container running)
        args.push(image, 'sleep', 'infinity');

        this.debugLog(`Docker command: docker ${args.join(' ')}`);

        return new Promise((resolve, reject) => {
            exec(`docker ${args.join(' ')}`, (error, stdout, stderr) => {
                if (error) {
                    this.debugLog(`Docker create failed: ${stderr}`);
                    reject(new Error(`Failed to create container: ${stderr}`));
                    return;
                }
                const containerId = stdout.trim();
                this.debugLog(`Created container: ${containerId}`);
                resolve(containerId);
            });
        });
    }

    /**
     * Create a Firecracker microVM
     */
    private async createFirecrackerVM(
        agentId: number,
        worktreePath: string,
        config?: ContainerConfig
    ): Promise<string> {
        // TODO: Implement Firecracker integration
        throw new Error('Firecracker VMs not yet implemented. Use Docker or gVisor tier instead.');
    }

    /**
     * Convert a path for Docker daemon access
     * On Windows with Docker Desktop, /mnt/c/... becomes /c/...
     */
    private toDockerPath(inputPath: string): string {
        const ap = agentPath(inputPath);
        const nodePath = ap.forNodeFs();

        // Docker Desktop on Windows uses /c/... format
        // Convert C:/Users/... to /c/Users/...
        const match = nodePath.match(/^([A-Za-z]):[\/\\](.*)$/);
        if (match) {
            return `/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
        }

        return nodePath;
    }

    /**
     * Stop and remove a container
     */
    async removeContainer(agentId: number): Promise<void> {
        const container = this.containers.get(agentId);
        if (!container) {
            return;
        }

        this.debugLog(`Removing container for agent ${agentId}`);

        if (container.tier === 'docker' || container.tier === 'gvisor') {
            try {
                execSync(`docker rm -f ${container.id}`, { stdio: 'ignore' });
            } catch (e) {
                this.debugLog(`Failed to remove container: ${e}`);
            }
        } else if (container.tier === 'firecracker') {
            // TODO: Implement Firecracker cleanup
        }

        this.containers.delete(agentId);
        await this.saveContainers();

        // Emit container removed event
        getEventBus().emit('container:removed', { agentId });
    }

    /**
     * Execute a command inside a container
     */
    async execInContainer(agentId: number, command: string): Promise<string> {
        const container = this.containers.get(agentId);
        if (!container) {
            throw new Error(`No container found for agent ${agentId}`);
        }

        if (container.tier === 'standard') {
            // No container - execute directly
            return execSync(command, { encoding: 'utf8' });
        }

        if (container.tier === 'docker' || container.tier === 'gvisor') {
            return new Promise((resolve, reject) => {
                exec(
                    `docker exec ${container.id} ${command}`,
                    { encoding: 'utf8' },
                    (error, stdout, stderr) => {
                        if (error) {
                            reject(new Error(`Exec failed: ${stderr}`));
                            return;
                        }
                        resolve(stdout);
                    }
                );
            });
        }

        throw new Error(`Exec not implemented for tier: ${container.tier}`);
    }

    /**
     * Get container info for an agent
     */
    getContainer(agentId: number): ContainerInfo | undefined {
        return this.containers.get(agentId);
    }

    /**
     * Get all containers
     */
    getAllContainers(): ContainerInfo[] {
        return Array.from(this.containers.values());
    }

    /**
     * Check if an agent is running in a container
     */
    isContainerized(agentId: number): boolean {
        const container = this.containers.get(agentId);
        return container !== undefined && container.tier !== 'standard';
    }

    // ========== Container Stats ==========

    /**
     * Get resource usage for a container
     */
    async getContainerStats(agentId: number): Promise<{ memoryMB: number; cpuPercent: number } | null> {
        const container = this.containers.get(agentId);
        if (!container || container.tier === 'standard') {
            return null;
        }

        if (container.tier === 'docker' || container.tier === 'gvisor') {
            try {
                const output = execSync(
                    `docker stats ${container.id} --no-stream --format "{{.MemUsage}},{{.CPUPerc}}"`,
                    { encoding: 'utf8', timeout: 5000 }
                );

                // Parse "100MiB / 4GiB,5.00%"
                const [memPart, cpuPart] = output.trim().split(',');
                const memMatch = memPart.match(/^([\d.]+)([A-Za-z]+)/);
                const cpuMatch = cpuPart?.match(/^([\d.]+)%/);

                let memoryMB = 0;
                if (memMatch) {
                    const value = parseFloat(memMatch[1]);
                    const unit = memMatch[2].toLowerCase();
                    if (unit.includes('gib') || unit.includes('gb')) {
                        memoryMB = value * 1024;
                    } else if (unit.includes('mib') || unit.includes('mb')) {
                        memoryMB = value;
                    } else if (unit.includes('kib') || unit.includes('kb')) {
                        memoryMB = value / 1024;
                    }
                }

                const cpuPercent = cpuMatch ? parseFloat(cpuMatch[1]) : 0;

                return { memoryMB, cpuPercent };
            } catch (e) {
                this.debugLog(`Failed to get container stats: ${e}`);
                return null;
            }
        }

        return null;
    }

    // ========== Persistence ==========

    private async saveContainers(): Promise<void> {
        if (isPersistenceServiceInitialized()) {
            getPersistenceService().saveContainers(this.containers);
        }
    }

    private async restoreContainers(): Promise<void> {
        if (!isPersistenceServiceInitialized()) {
            return;
        }

        const persisted = getPersistenceService().loadPersistedContainers();

        for (const p of persisted) {
            // Check if container is still running
            let state: ContainerState = 'stopped';

            if (p.tier === 'docker' || p.tier === 'gvisor') {
                try {
                    const output = execSync(
                        `docker inspect -f '{{.State.Running}}' ${p.id}`,
                        { encoding: 'utf8', timeout: 5000 }
                    );
                    state = output.trim() === 'true' ? 'running' : 'stopped';
                } catch {
                    state = 'stopped';
                }
            } else if (p.tier === 'standard') {
                state = 'running';  // Standard mode is always "running"
            }

            this.containers.set(p.agentId, {
                id: p.id,
                tier: p.tier,
                state,
                agentId: p.agentId,
                worktreePath: p.worktreePath,
                proxyPort: p.proxyPort,
                createdAt: new Date(p.createdAt),
            });
        }

        this.debugLog(`Restored ${this.containers.size} containers`);
    }

    /**
     * Find orphaned containers (running but not in our state)
     */
    async findOrphanedContainers(): Promise<string[]> {
        try {
            const output = execSync(
                `docker ps -q --filter "label=${CONTAINER_LABELS.managed}"`,
                { encoding: 'utf8', timeout: 5000 }
            );

            const runningIds = output.trim().split('\n').filter(id => id);
            const knownIds = new Set(
                Array.from(this.containers.values())
                    .filter(c => c.tier === 'docker' || c.tier === 'gvisor')
                    .map(c => c.id)
            );

            return runningIds.filter(id => !knownIds.has(id));
        } catch {
            return [];
        }
    }

    /**
     * Clean up orphaned containers
     */
    async cleanupOrphanedContainers(): Promise<number> {
        const orphans = await this.findOrphanedContainers();
        for (const id of orphans) {
            try {
                execSync(`docker rm -f ${id}`, { stdio: 'ignore' });
            } catch {
                // Ignore errors
            }
        }
        return orphans.length;
    }

    // ========== Repository Config ==========

    /**
     * Load container configuration from repository
     */
    loadRepoConfig(repoPath: string): ContainerConfig | undefined {
        const configPath = agentPath(repoPath)
            .join('.opus-orchestra', 'isolation.json')
            .forNodeFs();

        if (!fs.existsSync(configPath)) {
            return undefined;
        }

        try {
            const content = fs.readFileSync(configPath, 'utf8');
            return JSON.parse(content) as ContainerConfig;
        } catch (e) {
            this.debugLog(`Failed to load repo config: ${e}`);
            return undefined;
        }
    }

    // ========== Proxy Service ==========

    /**
     * Start the proxy service for network isolation
     * The proxy handles domain allowlisting and credential injection
     */
    async startProxy(): Promise<void> {
        if (this.proxyProcess) {
            return;  // Already running
        }

        // TODO: Implement proxy service
        // For now, this is a placeholder
        this.debugLog('Proxy service not yet implemented');
    }

    /**
     * Stop the proxy service
     */
    async stopProxy(): Promise<void> {
        if (this.proxyProcess) {
            this.proxyProcess.kill();
            this.proxyProcess = null;
        }
    }

    /**
     * Dispose of all resources
     */
    async dispose(): Promise<void> {
        await this.stopProxy();
        // Note: We don't automatically remove containers on dispose
        // They should be explicitly cleaned up or left for reconnection
    }
}
