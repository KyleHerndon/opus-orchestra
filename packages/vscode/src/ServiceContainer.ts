/**
 * ServiceContainer - Composition root for dependency injection
 *
 * Creates and wires all adapters, services, and managers.
 * Provides access to dependencies for gradual migration from singletons.
 */

import * as vscode from 'vscode';
import {
  // Adapters
  NodeSystemAdapter,
  SystemAdapter,

  // Services
  Logger,
  ILogger,
  EventBus,
  IEventBus,
  GitService,
  IGitService,
  StatusService,
  IStatusService,
  TmuxService,
  ITmuxService,
  TodoService,
  ITodoService,

  // Managers
  WorktreeManager as CoreWorktreeManager,
  IWorktreeManager,
  AgentStatusTracker as CoreAgentStatusTracker,
  IAgentStatusTracker,
  AgentPersistence as CoreAgentPersistence,
  IAgentPersistence,
  ContainerManager as CoreContainerManager,
  IContainerManager,

  // Container adapters
  ContainerRegistry,
  UnisolatedAdapter,
  DockerAdapter,

  // Config
  ConfigAdapter,
  StorageAdapter,
  UIAdapter,
  TerminalAdapter,
} from '@opus-orchestra/core';

import {
  VSCodeStorageAdapter,
  VSCodeConfigAdapter,
  VSCodeUIAdapter,
  VSCodeTerminalAdapter,
} from './adapters';

// CloudHypervisorAdapter is vscode-specific (not in core yet)
import { CloudHypervisorAdapter } from './containers/CloudHypervisorAdapter';

// ContainerConfigService implements IContainerConfigProvider
import { ContainerConfigService } from './services/ContainerConfigService';

// Path utilities for cross-platform support (WSL paths on Windows)
import { getHomeDir } from './pathUtils';

/**
 * Container for all application services.
 * Created once during extension activation.
 */
export class ServiceContainer {
  // Adapters
  public readonly system: SystemAdapter;
  public readonly storage: VSCodeStorageAdapter;
  public readonly config: ConfigAdapter;
  public readonly ui: UIAdapter;
  public readonly terminal: TerminalAdapter;

  // Core services
  public readonly logger: ILogger;
  public readonly eventBus: IEventBus;
  public readonly gitService: IGitService;
  public readonly statusService: IStatusService;
  public readonly tmuxService: ITmuxService;
  public readonly todoService: ITodoService;

  // Core managers
  public readonly worktreeManager: IWorktreeManager;
  public readonly statusTracker: IAgentStatusTracker;
  public readonly persistence: IAgentPersistence;
  public readonly containerManager: IContainerManager;

  // Container registry
  public readonly containerRegistry: ContainerRegistry;

  // Config provider (for container configs)
  public readonly containerConfigProvider: ContainerConfigService;

  // Extension context (needed for VS Code specific operations)
  private _context: vscode.ExtensionContext | null = null;

  constructor(extensionPath: string) {
    // 1. Create config adapter first (needed to read settings)
    this.config = new VSCodeConfigAdapter();

    // 2. Create other adapters using config values
    const terminalType = this.config.get('terminalType');
    this.system = new NodeSystemAdapter(terminalType);
    this.storage = new VSCodeStorageAdapter();
    this.ui = new VSCodeUIAdapter();
    this.terminal = new VSCodeTerminalAdapter(this.system);

    // 2. Create core services
    this.logger = new Logger(extensionPath, this.config.get('logLevel'));
    this.eventBus = new EventBus(this.logger);
    this.gitService = new GitService(this.system, this.logger);
    this.statusService = new StatusService(this.system, this.logger);
    this.tmuxService = new TmuxService(
      this.system,
      this.config.get('tmuxSessionPrefix'),
      this.logger
    );
    // TodoService needs correct path for WSL support on Windows
    // getHomeDir() returns the appropriate home directory based on terminal type
    const todosDir = getHomeDir().join('.claude', 'todos').forNodeFs();
    this.todoService = new TodoService(this.logger, todosDir);

    // 3. Create core managers
    this.worktreeManager = new CoreWorktreeManager(
      this.system,
      this.config,
      this.logger
    );
    this.statusTracker = new CoreAgentStatusTracker(
      this.statusService,
      this.gitService,
      this.todoService,
      this.eventBus,
      this.config,
      this.logger
    );
    this.persistence = new CoreAgentPersistence(
      this.worktreeManager,
      this.storage,
      this.logger
    );

    // 4. Create container registry with adapters
    this.containerRegistry = new ContainerRegistry();
    this.containerRegistry.register(new UnisolatedAdapter(this.system));
    this.containerRegistry.register(new DockerAdapter(this.system, this.logger));
    // CloudHypervisorAdapter is vscode-specific (uses agentPath, getConfigService)
    this.containerRegistry.register(new CloudHypervisorAdapter());

    // 5. Create container config provider and manager
    this.containerConfigProvider = new ContainerConfigService();
    this.containerManager = new CoreContainerManager(
      this.containerRegistry,
      this.containerConfigProvider,
      this.eventBus,
      this.storage,
      this.logger
    );
  }

  /**
   * Initialize the container with VS Code extension context.
   * Must be called during activation before using storage.
   */
  initialize(context: vscode.ExtensionContext): void {
    this._context = context;
    this.storage.initialize(context);
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
   * Dispose all resources.
   */
  dispose(): void {
    if (this.config instanceof VSCodeConfigAdapter) {
      (this.config as VSCodeConfigAdapter).dispose();
    }
    if (this.terminal instanceof VSCodeTerminalAdapter) {
      (this.terminal as VSCodeTerminalAdapter).disposeAll();
    }
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
  return containerInstance !== null;
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

