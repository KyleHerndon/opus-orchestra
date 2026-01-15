/**
 * ServiceContainer - Composition root for VS Code extension
 *
 * Thin wrapper around core ServiceContainer that provides
 * VS Code-specific adapters and features:
 * - VS Code workspace storage
 * - VS Code configuration API
 * - VS Code terminal integration
 * - CloudHypervisorAdapter for advanced container support
 */

import * as vscode from 'vscode';
import {
  // Core ServiceContainer
  ServiceContainer as CoreServiceContainer,

  // Adapters
  NodeSystemAdapter,
  SystemAdapter,
  ConfigAdapter,
  StorageAdapter,
  UIAdapter,
  TerminalAdapter,

  // Service interfaces
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
  IAgentFactory,
  ContainerRegistry,
} from '@opus-orchestra/core';

import {
  VSCodeStorageAdapter,
  VSCodeConfigAdapter,
  VSCodeUIAdapter,
  VSCodeTerminalAdapter,
} from './adapters';

// CloudHypervisorAdapter is vscode-specific (not in core)
import { CloudHypervisorAdapter } from './containers/CloudHypervisorAdapter';

// ContainerConfigService implements IContainerConfigProvider
import { ContainerConfigService } from './services/ContainerConfigService';

// Path utilities for cross-platform support (WSL paths on Windows)
import { getHomeDir } from './pathUtils';

/**
 * VS Code-specific ServiceContainer.
 *
 * Wraps the core ServiceContainer with VS Code-specific adapters:
 * - VSCodeConfigAdapter: Reads config from VS Code workspace settings
 * - VSCodeStorageAdapter: Persists data to VS Code workspace state
 * - VSCodeUIAdapter: VS Code-based UI interactions (dialogs, quick picks)
 * - VSCodeTerminalAdapter: VS Code integrated terminal management
 * - CloudHypervisorAdapter: Advanced container support (vscode-specific)
 */
export class ServiceContainer {
  // The core container does all the heavy lifting
  private _core: CoreServiceContainer;

  // VS Code-specific adapters (for dispose and direct access)
  private _vsCodeConfig: VSCodeConfigAdapter;
  private _vsCodeStorage: VSCodeStorageAdapter;
  private _vsCodeTerminal: VSCodeTerminalAdapter;

  // VS Code-specific config provider
  public readonly containerConfigProvider: ContainerConfigService;

  // Extension context (needed for VS Code specific operations)
  private _context: vscode.ExtensionContext | null = null;

  // Expose all core services via getters for compatibility
  get system(): SystemAdapter { return this._core.system; }
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
  get agentFactory(): IAgentFactory { return this._core.agentFactory; }
  get containerRegistry(): ContainerRegistry { return this._core.containerRegistry; }

  constructor(extensionPath: string) {
    // 1. Create VS Code-specific adapters
    this._vsCodeConfig = new VSCodeConfigAdapter();
    const terminalType = this._vsCodeConfig.get('terminalType');

    const system = new NodeSystemAdapter(terminalType);
    this._vsCodeStorage = new VSCodeStorageAdapter();
    const ui = new VSCodeUIAdapter();
    this._vsCodeTerminal = new VSCodeTerminalAdapter(system);

    // 2. Create VS Code-specific container config provider
    this.containerConfigProvider = new ContainerConfigService();

    // 3. Create CloudHypervisorAdapter wrapper for registration
    const cloudHypervisorAdapter = {
      register(registry: ContainerRegistry) {
        registry.register(new CloudHypervisorAdapter());
      }
    };

    // 4. Create core container with VS Code adapters
    // TodoService needs correct path for WSL support on Windows
    // getHomeDir() returns the appropriate home directory based on terminal type
    const todosDir = getHomeDir().join('.claude', 'todos').forNodeFs();

    this._core = new CoreServiceContainer({
      workingDirectory: extensionPath,
      adapters: {
        system,
        config: this._vsCodeConfig,
        storage: this._vsCodeStorage,
        ui,
        terminal: this._vsCodeTerminal,
      },
      services: {
        repoPath: '',  // Multi-repo: use scanWorktreesForAgents() with specific paths
        todosDirectory: todosDir,
        containerConfigProvider: this.containerConfigProvider,
        additionalContainerAdapters: [cloudHypervisorAdapter],
      },
    });
  }

  /**
   * Initialize the container with VS Code extension context.
   * Must be called during activation before using storage.
   */
  initialize(context: vscode.ExtensionContext): void {
    this._context = context;
    this._vsCodeStorage.initialize(context);
  }

  /**
   * Get the VS Code extension context.
   */
  get context(): vscode.ExtensionContext {
    if (!this._context) {
      throw new Error('ServiceContainer not initialized. Call initialize() first.');
    }
    return this._context;
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
    // Dispose VS Code-specific resources
    this._vsCodeConfig.dispose();
    this._vsCodeTerminal.disposeAll();

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
 * Call this once during extension activation.
 */
export function initializeContainer(
  extensionPath: string,
  context: vscode.ExtensionContext
): ServiceContainer {
  if (containerInstance) {
    containerInstance.dispose();
  }

  containerInstance = new ServiceContainer(extensionPath);
  containerInstance.initialize(context);

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
 * Dispose the global container (for testing/cleanup).
 */
export function disposeContainer(): void {
  if (containerInstance) {
    containerInstance.dispose();
    containerInstance = null;
  }
}

