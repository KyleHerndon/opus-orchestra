import * as vscode from 'vscode';
import { execSync, ChildProcess } from 'child_process';

// Import types from centralized types module
import {
    ContainerState,
    ContainerInfo,
    PersistedContainerInfo,
    ContainerType,
    CONTAINER_LABELS,
} from './types';

// Import services
import {
    getEventBus,
    getLogger,
    isLoggerInitialized,
    getPersistenceService,
    isPersistenceServiceInitialized,
    getContainerConfigService,
} from './services';

// Use containerRegistry from ServiceContainer
import { getContainer, isContainerInitialized } from './ServiceContainer';

// Re-export types
export { ContainerState, ContainerInfo, PersistedContainerInfo, ContainerType };

/**
 * ContainerManager handles lifecycle of isolated agent environments.
 * Uses adapters to support multiple container types: unisolated, docker, cloud-hypervisor.
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

    /**
     * Get a container adapter by type from ServiceContainer's registry.
     */
    private getAdapter(type: string) {
        if (!isContainerInitialized()) {
            return undefined;
        }
        return getContainer().containerRegistry.get(type);
    }

    // ========== Adapter-Based Methods (New) ==========

    /**
     * Get available container types via adapters.
     */
    async getAvailableContainerTypes(): Promise<ContainerType[]> {
        if (!isContainerInitialized()) {
            return [];
        }
        return getContainer().containerRegistry.getAvailableTypes();
    }

    /**
     * Create a container from a named config.
     *
     * @param configName - Prefixed config name (e.g., "repo:development", "user:secure", "unisolated")
     * @param worktreePath - Path to the worktree to mount
     * @param agentId - Agent ID for labeling
     * @param repoPath - Repository path for config discovery
     * @param sessionId - Claude session ID for auto-starting Claude in the container
     */
    async createContainer(
        configName: string,
        worktreePath: string,
        agentId: number,
        repoPath: string,
        sessionId?: string
    ): Promise<ContainerInfo> {
        this.debugLog(`createContainer: START configName='${configName}', agentId=${agentId}, repoPath='${repoPath}'`);

        const configService = getContainerConfigService();

        // Load the config reference
        const configRef = configService.loadConfigRef(configName, repoPath);
        if (!configRef) {
            throw new Error(`Container config '${configName}' not found`);
        }

        // Get the adapter for this container type
        const adapter = this.getAdapter(configRef.type);
        this.debugLog(`createContainer: configRef.type='${configRef.type}', adapter=${adapter ? adapter.type : 'null'}`);
        if (!adapter) {
            throw new Error(`No adapter registered for container type '${configRef.type}'`);
        }

        // Check if adapter is available
        const available = await adapter.isAvailable();
        this.debugLog(`createContainer: adapter.isAvailable()=${available}`);
        if (!available) {
            throw new Error(`Container type '${configRef.type}' is not available on this system`);
        }

        // Get the definition file path (if any)
        const definitionPath = configService.getDefinitionPath(configName, repoPath) || '';
        this.debugLog(`createContainer: definitionPath='${definitionPath}'`);

        // Create the container via adapter
        this.debugLog(`createContainer: calling adapter.create() with sessionId='${sessionId || 'none'}'`);
        const containerId = await adapter.create(definitionPath, worktreePath, agentId, sessionId);
        this.debugLog(`createContainer: adapter.create() returned containerId='${containerId}'`);

        const containerInfo: ContainerInfo = {
            id: containerId,
            configName,
            type: configRef.type,
            state: 'running',
            agentId,
            worktreePath,
            proxyPort: configRef.type !== 'unisolated' ? this.proxyPort : undefined,
            createdAt: new Date(),
        };

        this.containers.set(agentId, containerInfo);
        await this.saveContainers();

        // Emit container created event
        getEventBus().emit('container:created', { containerInfo });

        return containerInfo;
    }

    /**
     * Remove a container.
     */
    async removeContainer(agentId: number): Promise<void> {
        const container = this.containers.get(agentId);
        if (!container) {
            return;
        }

        this.debugLog(`Removing container for agent ${agentId}`);

        const adapter = this.getAdapter(container.type);

        if (adapter) {
            try {
                await adapter.destroy(container.id);
            } catch (e) {
                this.debugLog(`Failed to destroy container via adapter: ${e}`);
            }
        }

        this.containers.delete(agentId);
        await this.saveContainers();

        // Emit container removed event
        getEventBus().emit('container:removed', { agentId });
    }

    /**
     * Execute a command in container.
     */
    async execInContainer(agentId: number, command: string): Promise<string> {
        const container = this.containers.get(agentId);
        if (!container) {
            throw new Error(`No container found for agent ${agentId}`);
        }

        const adapter = this.getAdapter(container.type);

        if (!adapter) {
            throw new Error(`No adapter for container type '${container.type}'`);
        }

        return adapter.exec(container.id, command);
    }

    /**
     * Get container stats.
     */
    async getContainerStats(agentId: number): Promise<{ memoryMB: number; cpuPercent: number } | null> {
        const container = this.containers.get(agentId);
        if (!container) {
            return null;
        }

        const adapter = this.getAdapter(container.type);

        if (!adapter || !adapter.getStats) {
            return null;
        }

        return adapter.getStats(container.id);
    }

    /**
     * Get shell command for opening a terminal in a container.
     * Returns null if the container type doesn't support interactive terminals.
     */
    getShellCommand(agentId: number): { shellPath: string; shellArgs?: string[] } | null {
        const container = this.containers.get(agentId);
        if (!container) {
            return null;
        }

        const adapter = this.getAdapter(container.type);

        if (!adapter || !adapter.getShellCommand) {
            return null;
        }

        return adapter.getShellCommand(container.id, container.worktreePath);
    }

    // ========== Container Queries ==========

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
     * Check if an agent is running in a container (not unisolated)
     */
    isContainerized(agentId: number): boolean {
        const container = this.containers.get(agentId);
        return container !== undefined && container.type !== 'unisolated';
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

            if (p.type === 'docker') {
                try {
                    const output = execSync(
                        `docker inspect -f '{{.State.Running}}' ${p.id}`,
                        { encoding: 'utf8', timeout: 5000 }
                    );
                    state = output.trim() === 'true' ? 'running' : 'stopped';
                } catch {
                    state = 'stopped';
                }
            } else if (p.type === 'unisolated') {
                state = 'running';  // Unisolated mode is always "running"
            }

            this.containers.set(p.agentId, {
                id: p.id,
                configName: p.configName,
                type: p.type,
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
                    .filter(c => c.type === 'docker')
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

    /**
     * Clean up any container resources associated with a worktree path.
     * Called when deleting a worktree to ensure container resources are cleaned up.
     */
    async cleanupByWorktree(worktreePath: string): Promise<void> {
        this.debugLog(`Cleaning up containers for worktree: ${worktreePath}`);

        // Find any container for this worktree and remove it
        for (const [agentId, container] of this.containers) {
            if (container.worktreePath === worktreePath) {
                await this.removeContainer(agentId);
            }
        }

        // Also ask each adapter to clean up (handles orphaned VMs not in our state)
        const types = await this.getAvailableContainerTypes();
        for (const type of types) {
            const adapter = this.getAdapter(type);
            if (adapter?.cleanupByWorktree) {
                try {
                    await adapter.cleanupByWorktree(worktreePath);
                } catch (e) {
                    this.debugLog(`Adapter ${type} cleanup failed: ${e}`);
                }
            }
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
