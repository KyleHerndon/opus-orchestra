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
  TmuxService,
  createLogger,

  // Types
  ConfigAdapter,
  StorageAdapter,
  UIAdapter,
  TerminalAdapter,
  ILogger,
  IEventBus,
  IGitService,
  IStatusService,
  ITmuxService,
  ITodoService,
  IWorktreeManager,
  IAgentStatusTracker,
  IAgentPersistence,
  IContainerManager,
  ContainerRegistry,
} from '@opus-orchestra/core';

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
  private _core: CoreServiceContainer;

  // Terminal-specific adapters (for dispose)
  private _fileConfig: FileConfigAdapter;

  // Expose all core services via getters for compatibility
  get system() { return this._core.system; }
  get storage(): StorageAdapter { return this._core.storage; }
  get config(): ConfigAdapter { return this._core.config; }
  get ui(): UIAdapter { return this._core.ui; }
  get terminal(): TerminalAdapter { return this._core.terminal; }

  get logger(): ILogger { return this._core.logger; }
  get eventBus(): IEventBus { return this._core.eventBus; }
  get gitService(): IGitService { return this._core.gitService; }
  get statusService(): IStatusService { return this._core.statusService; }
  get tmuxService(): ITmuxService { return this._core.tmuxService; }
  get todoService(): ITodoService { return this._core.todoService; }

  get worktreeManager(): IWorktreeManager { return this._core.worktreeManager; }
  get statusTracker(): IAgentStatusTracker { return this._core.statusTracker; }
  get persistence(): IAgentPersistence { return this._core.persistence; }
  get containerManager(): IContainerManager { return this._core.containerManager; }
  get containerRegistry(): ContainerRegistry { return this._core.containerRegistry; }

  constructor(workingDirectory: string) {
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
    const tmuxService = new TmuxService(
      system,
      this._fileConfig.get('tmuxSessionPrefix'),
      earlyLogger
    );

    // 3. Create terminal adapter with TmuxService
    const terminal = new TmuxTerminalAdapter(system, tmuxService);

    // 4. Create core container with terminal adapters
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
      },
    });
  }

  /**
   * Check if the container has been disposed
   */
  get isDisposed(): boolean {
    return this._core.isDisposed;
  }

  /**
   * Dispose all resources.
   */
  dispose(): void {
    // Dispose terminal-specific resources
    this._fileConfig.dispose();

    // Dispose core container (stops polling, cleans up)
    this._core.dispose();
  }
}

// ============================================================================
// Global Container Instance
// ============================================================================

let containerInstance: ServiceContainer | null = null;

/**
 * Initialize the global service container.
 * Call this once during application startup.
 */
export function initializeContainer(workingDirectory: string): ServiceContainer {
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
export function getContainer(): ServiceContainer {
  if (!containerInstance) {
    throw new Error('ServiceContainer not initialized. Call initializeContainer() first.');
  }
  return containerInstance;
}

/**
 * Check if the container has been initialized.
 */
export function isContainerInitialized(): boolean {
  return containerInstance !== null && !containerInstance.isDisposed;
}

/**
 * Dispose the global container.
 */
export function disposeContainer(): void {
  if (containerInstance) {
    containerInstance.dispose();
    containerInstance = null;
  }
}
