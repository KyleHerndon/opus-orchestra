/**
 * Services module
 *
 * Re-exports service getters and utilities.
 * Classes are internal - use getter functions to access services.
 */

export { getConfigService, resetConfigService } from './ConfigService';
export { initLogger, getLogger, isLoggerInitialized } from './Logger';
export { getCommandService, resetCommandService } from './CommandService';
export { getGitService, resetGitService } from './GitService';
export { getStatusService, resetStatusService } from './StatusService';
export { getStatusWatcher, resetStatusWatcher } from './StatusWatcher';
export { getEventBus, resetEventBus } from './EventBus';
export { getCommandHandler, resetCommandHandler, OperationContext } from './CommandHandler';
export {
    initPersistenceService,
    getPersistenceService,
    isPersistenceServiceInitialized,
    resetPersistenceService,
} from './PersistenceService';
export { TodoItem, TodoState, getTodoService, resetTodoService } from './TodoService';
export { getTmuxService, resetTmuxService } from './TmuxService';
export {
    getContainerConfigService,
    isContainerConfigServiceInitialized,
    RepoContainerSettings,
    UserContainerSettings,
    DiscoveredConfig,
} from './ContainerConfigService';
