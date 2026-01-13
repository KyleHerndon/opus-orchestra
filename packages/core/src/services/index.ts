/**
 * Core services
 *
 * Platform-agnostic service implementations.
 */

// Logger
export {
  ILogger,
  LogLevel,
  createLogger,
  createNullLogger,
} from './Logger';

// EventBus
export {
  EventBus,
} from './EventBus';

// GitService
export {
  GitService,
  IGitService,
} from './GitService';

// StatusService
export {
  StatusService,
  IStatusService,
} from './StatusService';

// TmuxService
export {
  TmuxService,
  ITmuxService,
} from './TmuxService';

// TmuxControlWatcher
export {
  TmuxControlWatcher,
  TmuxControlWatcherManager,
  ITmuxControlWatcher,
  TmuxOutputEvent,
} from './TmuxControlWatcher';

// TodoService
export {
  TodoService,
  ITodoService,
  TodoItem,
  TodoState,
} from './TodoService';

// ServiceContainer
export {
  ServiceContainer,
  ServiceContainerOptions,
  PlatformAdapters,
  PlatformServices,
  initializeGlobalContainer,
  getGlobalContainer,
  isGlobalContainerInitialized,
  disposeGlobalContainer,
} from './ServiceContainer';
