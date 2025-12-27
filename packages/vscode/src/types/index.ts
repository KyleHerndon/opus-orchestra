/**
 * Opus Orchestra VSCode Extension - Types
 *
 * Re-exports types from @opus-orchestra/core and adds VSCode-specific types.
 */

// ============================================================================
// Re-export all core types
// ============================================================================

// Agent types from core
export {
    AgentStatus,
    DiffStats,
    PersistedAgent,
    PendingApproval,
    AgentDisplayData,
    AGENT_NAMES,
    STATUS_ICONS,
    AGENTS_STORAGE_KEY,
    AgentOrderMap,
    AGENT_ORDER_STORAGE_KEY,
} from '@opus-orchestra/core';

// Agent is now re-exported from core (uses TerminalHandle)
export { Agent } from './agent';

// Container types from core
export {
    ContainerType,
    ContainerConfigRef,
    ContainerState,
    ContainerMount,
    ContainerInfo,
    PersistedContainerInfo,
    CONTAINER_TYPE_DESCRIPTIONS,
    CONTAINER_LABELS,
    BLOCKED_HOST_PATHS,
    DEFAULT_CONTAINER_IMAGE,
    CONTAINERS_STORAGE_KEY,
    CONTAINER_RESOURCE_DEFAULTS,
    DEFAULT_PROXY_PORT,
} from '@opus-orchestra/core';

// Event types (now re-exported from core via ./events)
export {
    EventType,
    EventPayloads,
    EventHandler,
    IEventBus,
    OperationType,
    OperationStatus,
    CommandPayloads,
    OperationPayloads,
    DomainEventPayloads,
} from './events';

// Hook types from core
export {
    HookEventType,
    HookData,
    ParsedStatus,
} from '@opus-orchestra/core';

// Adapter types from core
export {
    TerminalType,
    ExtensionConfig,
    DEFAULT_CONFIG,
    POLLING_DEFAULTS,
    TerminalHandle,
    CreateTerminalOptions,
} from '@opus-orchestra/core';

// ============================================================================
// VSCode-specific types (not in core)
// ============================================================================

// VSCode terminal constants
export { GIT_BASH_PATH } from './terminal';

// VSCode-specific config section constant
export { CONFIG_SECTION } from './config';

// VSCode service interfaces
export {
    IGitService,
    IStatusService,
    ICommandService,
    ILogger,
} from './services';

// Webview UI types
export {
    formatTimeSince,
    AgentPanelMessageType,
    AgentPanelMessage,
} from './ui';
