/**
 * ServiceContainer - Composition root for terminal package
 *
 * Creates and wires all adapters, services, and managers for the terminal UI.
 * Uses file-based storage and config instead of VS Code APIs.
 */
import { 
// Adapters
NodeSystemAdapter, 
// Services
Logger, EventBus, GitService, StatusService, TmuxService, TodoService, 
// Managers
WorktreeManager, AgentStatusTracker, AgentPersistence, ContainerManager, 
// Container adapters
ContainerRegistry, UnisolatedAdapter, DockerAdapter, } from '@opus-orchestra/core';
import { FileStorageAdapter } from '../adapters/FileStorageAdapter.js';
import { FileConfigAdapter } from '../adapters/FileConfigAdapter.js';
import { TerminalUIAdapter } from '../adapters/TerminalUIAdapter.js';
import { TmuxTerminalAdapter } from '../adapters/TmuxTerminalAdapter.js';
/**
 * Simple container config provider that returns unisolated by default.
 * Can be extended to read config files from the filesystem.
 */
class SimpleContainerConfigProvider {
    loadConfigRef(prefixedName, _repoPath) {
        // Parse the prefixed name
        if (prefixedName === 'unisolated' || !prefixedName) {
            return { type: 'unisolated' };
        }
        // For docker configs, return a basic docker config
        // The actual docker image is configured separately
        if (prefixedName.startsWith('docker:') || prefixedName === 'docker') {
            return { type: 'docker' };
        }
        // Default to unisolated
        return { type: 'unisolated' };
    }
    getDefinitionPath(_prefixedName, _repoPath) {
        // No definition files in simple mode
        return undefined;
    }
}
/**
 * Container for all terminal application services.
 */
export class ServiceContainer {
    // Adapters
    system;
    storage;
    config;
    ui;
    terminal;
    // Core services
    logger;
    eventBus;
    gitService;
    statusService;
    tmuxService;
    todoService;
    // Core managers
    worktreeManager;
    statusTracker;
    persistence;
    containerManager;
    // Container registry
    containerRegistry;
    constructor(workingDirectory) {
        // 1. Create config adapter first (needed to read settings)
        this.config = new FileConfigAdapter(workingDirectory);
        // 2. Create other adapters using config values
        const terminalType = this.config.get('terminalType');
        this.system = new NodeSystemAdapter(terminalType);
        this.storage = new FileStorageAdapter(workingDirectory);
        this.ui = new TerminalUIAdapter();
        this.terminal = new TmuxTerminalAdapter(this.system);
        // 3. Create core services
        this.logger = new Logger(workingDirectory, this.config.get('logLevel'));
        this.eventBus = new EventBus(this.logger);
        this.gitService = new GitService(this.system, this.logger);
        this.statusService = new StatusService(this.system, this.logger);
        this.tmuxService = new TmuxService(this.system, this.config.get('tmuxSessionPrefix'), this.logger);
        this.todoService = new TodoService(this.logger);
        // 4. Create core managers
        this.worktreeManager = new WorktreeManager(this.system, this.config, this.logger);
        this.statusTracker = new AgentStatusTracker(this.statusService, this.gitService, this.todoService, this.eventBus, this.config, this.logger);
        this.persistence = new AgentPersistence(this.worktreeManager, this.storage, this.logger);
        // 5. Create container registry with adapters
        this.containerRegistry = new ContainerRegistry();
        this.containerRegistry.register(new UnisolatedAdapter(this.system));
        this.containerRegistry.register(new DockerAdapter(this.system, this.logger));
        // 6. Create container manager
        const configProvider = new SimpleContainerConfigProvider();
        this.containerManager = new ContainerManager(this.containerRegistry, configProvider, this.eventBus, this.storage, this.logger);
    }
    /**
     * Dispose all resources.
     */
    dispose() {
        if (this.config instanceof FileConfigAdapter) {
            this.config.dispose();
        }
    }
}
// ============================================================================
// Global Container Instance
// ============================================================================
let containerInstance = null;
/**
 * Initialize the global service container.
 * Call this once during application startup.
 */
export function initializeContainer(workingDirectory) {
    if (containerInstance) {
        containerInstance.dispose();
    }
    containerInstance = new ServiceContainer(workingDirectory);
    return containerInstance;
}
/**
 * Get the global service container.
 * Throws if not initialized.
 */
export function getContainer() {
    if (!containerInstance) {
        throw new Error('ServiceContainer not initialized. Call initializeContainer() first.');
    }
    return containerInstance;
}
/**
 * Check if the container has been initialized.
 */
export function isContainerInitialized() {
    return containerInstance !== null;
}
/**
 * Dispose the global container.
 */
export function disposeContainer() {
    if (containerInstance) {
        containerInstance.dispose();
        containerInstance = null;
    }
}
//# sourceMappingURL=ServiceContainer.js.map