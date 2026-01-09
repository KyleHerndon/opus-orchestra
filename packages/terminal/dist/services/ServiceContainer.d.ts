/**
 * ServiceContainer - Composition root for terminal package
 *
 * Creates and wires all adapters, services, and managers for the terminal UI.
 * Uses file-based storage and config instead of VS Code APIs.
 */
import { SystemAdapter, ILogger, IEventBus, IGitService, IStatusService, ITmuxService, ITodoService, IWorktreeManager, IAgentStatusTracker, IAgentPersistence, IContainerManager, ContainerRegistry, ConfigAdapter, StorageAdapter, UIAdapter, TerminalAdapter } from '@opus-orchestra/core';
/**
 * Container for all terminal application services.
 */
export declare class ServiceContainer {
    readonly system: SystemAdapter;
    readonly storage: StorageAdapter;
    readonly config: ConfigAdapter;
    readonly ui: UIAdapter;
    readonly terminal: TerminalAdapter;
    readonly logger: ILogger;
    readonly eventBus: IEventBus;
    readonly gitService: IGitService;
    readonly statusService: IStatusService;
    readonly tmuxService: ITmuxService;
    readonly todoService: ITodoService;
    readonly worktreeManager: IWorktreeManager;
    readonly statusTracker: IAgentStatusTracker;
    readonly persistence: IAgentPersistence;
    readonly containerManager: IContainerManager;
    readonly containerRegistry: ContainerRegistry;
    constructor(workingDirectory: string);
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