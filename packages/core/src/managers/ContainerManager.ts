/**
 * ContainerManager - Container lifecycle management
 *
 * Platform-agnostic implementation for managing container instances.
 * Uses adapters for container operations and a config provider for config discovery.
 */

import { execSync } from 'child_process';
import {
  ContainerInfo,
  ContainerConfigRef,
  ContainerState,
  ContainerType,
  PersistedContainerInfo,
  CONTAINER_LABELS,
} from '../types/container';
import { ContainerRegistry, ContainerStats, ShellCommand } from '../containers';
import { IEventBus } from '../types';
import { ILogger } from '../services/Logger';
import { StorageAdapter } from '../adapters/StorageAdapter';

// Re-export ContainerConfigRef for convenience
export { ContainerConfigRef };

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Provider interface for container configuration discovery.
 * Platform-specific implementations handle config file discovery.
 */
export interface IContainerConfigProvider {
  /**
   * Load a config reference by prefixed name.
   * @param prefixedName - Config name (e.g., "repo:development", "user:secure", "unisolated")
   * @param repoPath - Repository path for config discovery
   */
  loadConfigRef(prefixedName: string, repoPath: string): ContainerConfigRef | undefined;

  /**
   * Get the absolute path to a container definition file.
   * @param prefixedName - Config name
   * @param repoPath - Repository path for config discovery
   */
  getDefinitionPath(prefixedName: string, repoPath: string): string | undefined;
}

/**
 * Container manager interface
 */
export interface IContainerManager {
  // Lifecycle
  createContainer(
    configName: string,
    worktreePath: string,
    agentId: number,
    repoPath: string,
    sessionId?: string
  ): Promise<ContainerInfo>;
  removeContainer(agentId: number): Promise<void>;

  // Operations
  execInContainer(agentId: number, command: string): Promise<string>;
  getContainerStats(agentId: number): Promise<ContainerStats | null>;
  getShellCommand(agentId: number): ShellCommand | null;

  // Queries
  getContainer(agentId: number): ContainerInfo | undefined;
  getAllContainers(): ContainerInfo[];
  isContainerized(agentId: number): boolean;
  getAvailableContainerTypes(): Promise<ContainerType[]>;

  // Cleanup
  cleanupByWorktree(worktreePath: string): Promise<void>;
  findOrphanedContainers(): Promise<string[]>;
  cleanupOrphanedContainers(): Promise<number>;

  // Disposal
  dispose(): Promise<void>;
}

// ============================================================================
// Implementation
// ============================================================================

const CONTAINERS_STORAGE_KEY = 'opus.containers';

/**
 * Container manager implementation.
 * Handles lifecycle of isolated agent environments.
 */
export class ContainerManager implements IContainerManager {
  private containers: Map<number, ContainerInfo> = new Map();
  private readonly containerRegistry: ContainerRegistry;
  private readonly configProvider: IContainerConfigProvider;
  private readonly eventBus: IEventBus;
  private readonly storage: StorageAdapter;
  private readonly logger?: ILogger;

  constructor(
    containerRegistry: ContainerRegistry,
    configProvider: IContainerConfigProvider,
    eventBus: IEventBus,
    storage: StorageAdapter,
    logger?: ILogger
  ) {
    this.containerRegistry = containerRegistry;
    this.configProvider = configProvider;
    this.eventBus = eventBus;
    this.storage = storage;
    this.logger = logger?.child({ component: 'ContainerManager' });

    // Restore containers from storage on construction
    this.restoreContainers();
  }

  // ========================================================================
  // Container Lifecycle
  // ========================================================================

  /**
   * Create a container from a named config.
   */
  async createContainer(
    configName: string,
    worktreePath: string,
    agentId: number,
    repoPath: string,
    sessionId?: string
  ): Promise<ContainerInfo> {
    this.logger?.debug(
      `createContainer: START configName='${configName}', agentId=${agentId}, repoPath='${repoPath}'`
    );

    // Load the config reference
    const configRef = this.configProvider.loadConfigRef(configName, repoPath);
    if (!configRef) {
      throw new Error(`Container config '${configName}' not found`);
    }

    // Get the adapter for this container type
    const adapter = this.containerRegistry.get(configRef.type);
    this.logger?.debug(
      `createContainer: configRef.type='${configRef.type}', adapter=${adapter ? adapter.type : 'null'}`
    );
    if (!adapter) {
      throw new Error(`No adapter registered for container type '${configRef.type}'`);
    }

    // Check if adapter is available
    const available = await adapter.isAvailable();
    this.logger?.debug(`createContainer: adapter.isAvailable()=${available}`);
    if (!available) {
      throw new Error(`Container type '${configRef.type}' is not available on this system`);
    }

    // Get the definition file path (if any)
    const definitionPath = this.configProvider.getDefinitionPath(configName, repoPath) || '';
    this.logger?.debug(`createContainer: definitionPath='${definitionPath}'`);

    // Create the container via adapter
    this.logger?.debug(
      `createContainer: calling adapter.create() with sessionId='${sessionId || 'none'}'`
    );
    const containerId = await adapter.create(definitionPath, worktreePath, agentId, sessionId);
    this.logger?.debug(`createContainer: adapter.create() returned containerId='${containerId}'`);

    const containerInfo: ContainerInfo = {
      id: containerId,
      configName,
      type: configRef.type,
      state: 'running',
      agentId,
      worktreePath,
      createdAt: new Date(),
    };

    this.containers.set(agentId, containerInfo);
    this.saveContainers();

    // Emit container created event
    this.eventBus.emit('container:created', { containerInfo });

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

    this.logger?.debug(`Removing container for agent ${agentId}`);

    const adapter = this.containerRegistry.get(container.type);

    if (adapter) {
      try {
        await adapter.destroy(container.id);
      } catch (e) {
        this.logger?.debug(`Failed to destroy container via adapter: ${e}`);
      }
    }

    this.containers.delete(agentId);
    this.saveContainers();

    // Emit container removed event
    this.eventBus.emit('container:removed', { agentId });
  }

  // ========================================================================
  // Container Operations
  // ========================================================================

  /**
   * Execute a command in container.
   */
  async execInContainer(agentId: number, command: string): Promise<string> {
    const container = this.containers.get(agentId);
    if (!container) {
      throw new Error(`No container found for agent ${agentId}`);
    }

    const adapter = this.containerRegistry.get(container.type);

    if (!adapter) {
      throw new Error(`No adapter for container type '${container.type}'`);
    }

    return adapter.exec(container.id, command);
  }

  /**
   * Get container stats.
   */
  async getContainerStats(agentId: number): Promise<ContainerStats | null> {
    const container = this.containers.get(agentId);
    if (!container) {
      return null;
    }

    const adapter = this.containerRegistry.get(container.type);

    if (!adapter || !adapter.getStats) {
      return null;
    }

    return adapter.getStats(container.id);
  }

  /**
   * Get shell command for opening a terminal in a container.
   */
  getShellCommand(agentId: number): ShellCommand | null {
    const container = this.containers.get(agentId);
    if (!container) {
      return null;
    }

    const adapter = this.containerRegistry.get(container.type);

    if (!adapter || !adapter.getShellCommand) {
      return null;
    }

    return adapter.getShellCommand(container.id, container.worktreePath);
  }

  // ========================================================================
  // Container Queries
  // ========================================================================

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

  /**
   * Get available container types via adapters.
   */
  async getAvailableContainerTypes(): Promise<ContainerType[]> {
    return this.containerRegistry.getAvailableTypes();
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  /**
   * Clean up any container resources associated with a worktree path.
   */
  async cleanupByWorktree(worktreePath: string): Promise<void> {
    this.logger?.debug(`Cleaning up containers for worktree: ${worktreePath}`);

    // Find any container for this worktree and remove it
    for (const [agentId, container] of this.containers) {
      if (container.worktreePath === worktreePath) {
        await this.removeContainer(agentId);
      }
    }

    // Also ask each adapter to clean up (handles orphaned VMs not in our state)
    const types = await this.getAvailableContainerTypes();
    for (const type of types) {
      const adapter = this.containerRegistry.get(type);
      if (adapter?.cleanupByWorktree) {
        try {
          await adapter.cleanupByWorktree(worktreePath);
        } catch (e) {
          this.logger?.debug(`Adapter ${type} cleanup failed: ${e}`);
        }
      }
    }
  }

  /**
   * Find orphaned containers (running but not in our state).
   * Currently only supports Docker.
   */
  async findOrphanedContainers(): Promise<string[]> {
    try {
      const output = execSync(
        `docker ps -q --filter "label=${CONTAINER_LABELS.managed}"`,
        { encoding: 'utf8', timeout: 5000 }
      );

      const runningIds = output.trim().split('\n').filter((id) => id);
      const knownIds = new Set(
        Array.from(this.containers.values())
          .filter((c) => c.type === 'docker')
          .map((c) => c.id)
      );

      return runningIds.filter((id) => !knownIds.has(id));
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
        execSync(`docker rm -f ${id}`, { stdio: 'ignore', timeout: 5000 });
      } catch {
        // Ignore errors
      }
    }
    return orphans.length;
  }

  // ========================================================================
  // Persistence
  // ========================================================================

  private saveContainers(): void {
    const persisted: PersistedContainerInfo[] = [];
    for (const container of this.containers.values()) {
      persisted.push({
        id: container.id,
        configName: container.configName,
        type: container.type,
        agentId: container.agentId,
        worktreePath: container.worktreePath,
        proxyPort: container.proxyPort,
        createdAt: container.createdAt.toISOString(),
      });
    }
    this.storage.set(CONTAINERS_STORAGE_KEY, persisted);
  }

  private restoreContainers(): void {
    const persisted = this.storage.get<PersistedContainerInfo[]>(CONTAINERS_STORAGE_KEY, []);

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
        state = 'running'; // Unisolated mode is always "running"
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

    this.logger?.debug(`Restored ${this.containers.size} containers`);
  }

  // ========================================================================
  // Disposal
  // ========================================================================

  async dispose(): Promise<void> {
    // Note: We don't automatically remove containers on dispose
    // They should be explicitly cleaned up or left for reconnection
  }
}
