/**
 * ServiceContainer - Composition root for terminal package
 *
 * Thin wrapper around core ServiceContainer that provides
 * terminal-specific adapters (file-based storage, tmux terminal).
 */
import { LogStream, ConfigAdapter, StorageAdapter, UIAdapter, TerminalAdapter, ILogger, IEventBus, IGitService, IStatusService, ITmuxService, ITodoService, IWorktreeManager, IAgentStatusTracker, IAgentPersistence, IContainerManager, IAgentFactory, ContainerRegistry } from '@opus-orchestra/core';
/**
 * Terminal-specific ServiceContainer.
 *
 * Wraps the core ServiceContainer with terminal-specific adapters:
 * - FileConfigAdapter: Reads config from filesystem
 * - FileStorageAdapter: Persists data to filesystem
 * - TerminalUIAdapter: Terminal-based UI interactions
 * - TmuxTerminalAdapter: Tmux session management
 */
export declare class ServiceContainer {
    private _core;
    private _fileConfig;
    private _uiLogStream;
    get system(): import("@opus-orchestra/core").SystemAdapter;
    get storage(): StorageAdapter;
    get config(): ConfigAdapter;
    get ui(): UIAdapter;
    get terminal(): TerminalAdapter;
    get logger(): ILogger;
    get eventBus(): IEventBus;
    get gitService(): IGitService;
    get statusService(): IStatusService;
    get tmuxService(): ITmuxService;
    get todoService(): ITodoService;
    get worktreeManager(): IWorktreeManager;
    get statusTracker(): IAgentStatusTracker;
    get persistence(): IAgentPersistence;
    get containerManager(): IContainerManager;
    get agentFactory(): IAgentFactory;
    get containerRegistry(): ContainerRegistry;
    /** Log stream that captures error/warn for UI display */
    get uiLogStream(): LogStream;
    constructor(workingDirectory: string);
    /**
     * Check if the container has been disposed
     */
    get isDisposed(): boolean;
    /**
     * Dispose all resources.
     */
    dispose(): void;
}
/**
 * Initialize the global service container.
 * Call this once during application startup.
 */
export declare function initializeContainer(workingDirectory: string): ServiceContainer;
/**
 * Get the global service container.
 * Throws if not initialized.
 */
export declare function getContainer(): ServiceContainer;
/**
 * Check if the container has been initialized.
 */
export declare function isContainerInitialized(): boolean;
/**
 * Dispose the global container.
 */
export declare function disposeContainer(): void;
//# sourceMappingURL=ServiceContainer.d.ts.map