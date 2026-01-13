/**
 * ServiceContainer - Base composition root for dependency injection
 *
 * Creates and wires all core services and managers.
 * Platform-specific packages (terminal, vscode) provide adapter implementations.
 *
 * Features:
 * - Deterministic initialization order
 * - Automatic cleanup on dispose
 * - Process exit hooks for safety
 */

import { Mutex } from 'async-mutex';
import {
  SystemAdapter,
  ConfigAdapter,
  StorageAdapter,
  UIAdapter,
  TerminalAdapter,
} from '../adapters';
import { createLogger, ILogger } from './Logger';
import { EventBus } from './EventBus';
import { IEventBus } from '../types/events';
import { GitService, IGitService } from './GitService';
import { StatusService, IStatusService } from './StatusService';
import { TmuxService, ITmuxService } from './TmuxService';
import { TodoService, ITodoService } from './TodoService';
import {
  WorktreeManager,
  IWorktreeManager,
  AgentStatusTracker,
  IAgentStatusTracker,
  AgentPersistence,
  IAgentPersistence,
  ContainerManager,
  IContainerManager,
  IContainerConfigProvider,
} from '../managers';
import { ContainerRegistry, UnisolatedAdapter, DockerAdapter } from '../containers';

/**
 * Platform-specific adapters that must be provided
 */
export interface PlatformAdapters {
  system: SystemAdapter;
  config: ConfigAdapter;
  storage: StorageAdapter;
  ui: UIAdapter;
  terminal: TerminalAdapter;
}

/**
 * Optional platform-specific services
 */
export interface PlatformServices {
  /** Custom container config provider */
  containerConfigProvider?: IContainerConfigProvider;
  /** Additional container adapters to register */
  additionalContainerAdapters?: Array<{ register(registry: ContainerRegistry): void }>;
  /** Custom todos directory path (for WSL support) */
  todosDirectory?: string;
  /** Repo path for single-repo mode (empty for multi-repo) */
  repoPath?: string;
}

/**
 * Container initialization options
 */
export interface ServiceContainerOptions {
  /** Working directory / extension path for logs */
  workingDirectory: string;
  /** Platform adapters */
  adapters: PlatformAdapters;
  /** Optional platform services */
  services?: PlatformServices;
}

/**
 * Simple container config provider that returns unisolated by default
 */
class DefaultContainerConfigProvider implements IContainerConfigProvider {
  loadConfigRef(prefixedName: string): { type: string } | undefined {
    if (prefixedName === 'unisolated' || !prefixedName) {
      return { type: 'unisolated' };
    }
    if (prefixedName.startsWith('docker:') || prefixedName === 'docker') {
      return { type: 'docker' };
    }
    return { type: 'unisolated' };
  }

  getDefinitionPath(): string | undefined {
    return undefined;
  }
}

/**
 * Base ServiceContainer with all core services wired up.
 *
 * Usage:
 * ```typescript
 * const container = new ServiceContainer({
 *   workingDirectory: '/path/to/workspace',
 *   adapters: {
 *     system: new NodeSystemAdapter('wsl'),
 *     config: new FileConfigAdapter('/path'),
 *     storage: new FileStorageAdapter('/path'),
 *     ui: new TerminalUIAdapter(),
 *     terminal: new TmuxTerminalAdapter(system, tmuxService),
 *   },
 * });
 * ```
 */
export class ServiceContainer {
  // Platform adapters (provided by caller)
  public readonly system: SystemAdapter;
  public readonly config: ConfigAdapter;
  public readonly storage: StorageAdapter;
  public readonly ui: UIAdapter;
  public readonly terminal: TerminalAdapter;

  // Core services (created here)
  public readonly logger: ILogger;
  public readonly eventBus: IEventBus;
  public readonly gitService: IGitService;
  public readonly statusService: IStatusService;
  public readonly tmuxService: ITmuxService;
  public readonly todoService: ITodoService;

  // Core managers (created here)
  public readonly worktreeManager: IWorktreeManager;
  public readonly statusTracker: IAgentStatusTracker;
  public readonly persistence: IAgentPersistence;
  public readonly containerManager: IContainerManager;

  // Container registry
  public readonly containerRegistry: ContainerRegistry;

  // Shared mutex for agent state updates
  public readonly agentMutex: Mutex;

  // Cleanup state
  private _disposed = false;
  private _exitHandler: (() => void) | null = null;

  constructor(options: ServiceContainerOptions) {
    const { workingDirectory, adapters, services = {} } = options;

    // Store adapters
    this.system = adapters.system;
    this.config = adapters.config;
    this.storage = adapters.storage;
    this.ui = adapters.ui;
    this.terminal = adapters.terminal;

    // Create shared mutex for agent operations
    this.agentMutex = new Mutex();

    // Create logger first (needed by other services)
    const logDir = `${workingDirectory}/.opus-orchestra`;
    this.logger = createLogger(logDir, this.config.get('logLevel'));

    // Create TmuxService early (terminal adapter may need it)
    this.tmuxService = new TmuxService(
      this.system,
      this.config.get('tmuxSessionPrefix'),
      this.logger
    );

    // Create core services
    this.eventBus = new EventBus(this.logger);
    this.gitService = new GitService(this.logger);
    this.statusService = new StatusService(this.system, this.logger);
    this.todoService = new TodoService(this.logger, services.todosDirectory);

    // Create managers
    this.worktreeManager = new WorktreeManager(
      this.system,
      this.config,
      this.logger
    );

    this.statusTracker = new AgentStatusTracker(
      this.statusService,
      this.gitService,
      this.todoService,
      this.eventBus,
      this.config,
      this.logger
    );

    this.persistence = new AgentPersistence(
      this.worktreeManager,
      services.repoPath ?? '',
      this.logger
    );

    // Create container registry with default adapters
    this.containerRegistry = new ContainerRegistry();
    this.containerRegistry.register(new UnisolatedAdapter(this.system));
    this.containerRegistry.register(new DockerAdapter(this.system, this.logger));

    // Register additional container adapters if provided
    if (services.additionalContainerAdapters) {
      for (const adapter of services.additionalContainerAdapters) {
        adapter.register(this.containerRegistry);
      }
    }

    // Create container manager
    const configProvider = services.containerConfigProvider ?? new DefaultContainerConfigProvider();
    this.containerManager = new ContainerManager(
      this.containerRegistry,
      configProvider,
      this.eventBus,
      this.storage,
      this.logger
    );

    // Register process exit handler for cleanup
    this._registerExitHandler();
  }

  /**
   * Check if the container has been disposed
   */
  get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * Dispose all resources.
   * Safe to call multiple times.
   */
  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;

    // Remove exit handler
    if (this._exitHandler) {
      process.removeListener('exit', this._exitHandler);
      process.removeListener('SIGINT', this._exitHandler);
      process.removeListener('SIGTERM', this._exitHandler);
      this._exitHandler = null;
    }

    // Stop polling/watching
    this.statusTracker.stopPolling();

    // Log shutdown
    this.logger.info('ServiceContainer disposed');
  }

  /**
   * Register process exit handlers for automatic cleanup
   */
  private _registerExitHandler(): void {
    this._exitHandler = () => {
      this.dispose();
    };

    process.on('exit', this._exitHandler);
    process.on('SIGINT', this._exitHandler);
    process.on('SIGTERM', this._exitHandler);
  }
}

// ============================================================================
// Global Container Management
// ============================================================================

let globalContainer: ServiceContainer | null = null;

/**
 * Initialize the global service container.
 * Disposes any existing container first.
 */
export function initializeGlobalContainer(options: ServiceContainerOptions): ServiceContainer {
  if (globalContainer) {
    globalContainer.dispose();
  }
  globalContainer = new ServiceContainer(options);
  return globalContainer;
}

/**
 * Get the global service container.
 * Throws if not initialized.
 */
export function getGlobalContainer(): ServiceContainer {
  if (!globalContainer) {
    throw new Error('ServiceContainer not initialized. Call initializeGlobalContainer() first.');
  }
  return globalContainer;
}

/**
 * Check if the global container has been initialized.
 */
export function isGlobalContainerInitialized(): boolean {
  return globalContainer !== null && !globalContainer.isDisposed;
}

/**
 * Dispose the global container.
 */
export function disposeGlobalContainer(): void {
  if (globalContainer) {
    globalContainer.dispose();
    globalContainer = null;
  }
}
