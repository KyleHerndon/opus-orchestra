/**
 * ServiceContainer - Composition root for terminal package
 *
 * Thin wrapper around core ServiceContainer that provides
 * terminal-specific adapters (file-based storage, tmux terminal).
 */
import { 
// Core ServiceContainer
ServiceContainer as CoreServiceContainer, 
// Adapters
NodeSystemAdapter, 
// Services (for creating TmuxService before core)
TmuxService, createLogger, } from '@opus-orchestra/core';
import { FileStorageAdapter } from '../adapters/FileStorageAdapter.js';
import { FileConfigAdapter } from '../adapters/FileConfigAdapter.js';
import { TerminalUIAdapter } from '../adapters/TerminalUIAdapter.js';
import { TmuxTerminalAdapter } from '../adapters/TmuxTerminalAdapter.js';
/**
 * Terminal-specific ServiceContainer.
 *
 * Wraps the core ServiceContainer with terminal-specific adapters:
 * - FileConfigAdapter: Reads config from filesystem
 * - FileStorageAdapter: Persists data to filesystem
 * - TerminalUIAdapter: Terminal-based UI interactions
 * - TmuxTerminalAdapter: Tmux session management
 */
export class ServiceContainer {
    // The core container does all the heavy lifting
    _core;
    // Terminal-specific adapters (for dispose)
    _fileConfig;
    // Expose all core services via getters for compatibility
    get system() { return this._core.system; }
    get storage() { return this._core.storage; }
    get config() { return this._core.config; }
    get ui() { return this._core.ui; }
    get terminal() { return this._core.terminal; }
    get logger() { return this._core.logger; }
    get eventBus() { return this._core.eventBus; }
    get gitService() { return this._core.gitService; }
    get statusService() { return this._core.statusService; }
    get tmuxService() { return this._core.tmuxService; }
    get todoService() { return this._core.todoService; }
    get worktreeManager() { return this._core.worktreeManager; }
    get statusTracker() { return this._core.statusTracker; }
    get persistence() { return this._core.persistence; }
    get containerManager() { return this._core.containerManager; }
    get containerRegistry() { return this._core.containerRegistry; }
    constructor(workingDirectory) {
        // 1. Create terminal-specific adapters
        this._fileConfig = new FileConfigAdapter(workingDirectory);
        const terminalType = this._fileConfig.get('terminalType');
        const system = new NodeSystemAdapter(terminalType);
        const storage = new FileStorageAdapter(workingDirectory);
        const ui = new TerminalUIAdapter();
        // 2. Create TmuxService early (needed by TmuxTerminalAdapter)
        // We create our own logger here for TmuxService since core hasn't been created yet
        const logDir = `${workingDirectory}/.opus-orchestra`;
        const earlyLogger = createLogger(logDir, this._fileConfig.get('logLevel'));
        const tmuxService = new TmuxService(system, this._fileConfig.get('tmuxSessionPrefix'), earlyLogger);
        // 3. Create terminal adapter with TmuxService
        const terminal = new TmuxTerminalAdapter(system, tmuxService);
        // 4. Compute todosDirectory using system adapter
        // TodoService needs correct path for WSL support - ~/.claude/todos
        const homeDir = system.getHomeDirectory();
        const todosDir = system.joinPath(homeDir, '.claude', 'todos');
        // 5. Create core container with terminal adapters
        this._core = new CoreServiceContainer({
            workingDirectory,
            adapters: {
                system,
                config: this._fileConfig,
                storage,
                ui,
                terminal,
            },
            services: {
                repoPath: workingDirectory,
                todosDirectory: todosDir,
            },
        });
    }
    /**
     * Check if the container has been disposed
     */
    get isDisposed() {
        return this._core.isDisposed;
    }
    /**
     * Dispose all resources.
     */
    dispose() {
        // Dispose terminal-specific resources
        this._fileConfig.dispose();
        // Dispose core container (stops polling, cleans up)
        this._core.dispose();
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
    return containerInstance !== null && !containerInstance.isDisposed;
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