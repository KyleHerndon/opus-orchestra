/**
 * Opus Orchestra VSCode Extension - Types
 *
 * Re-exports types from @opus-orchestra/core and adds VSCode-specific types.
 */

// ============================================================================
// Re-export all core types
// ============================================================================

// Agent types from core (including Agent which uses TerminalHandle)
export {
    Agent,
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

// Event types from core
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
} from '@opus-orchestra/core';

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

// Service interfaces from core
export {
    IGitService,
    IStatusService,
    ILogger,
} from '@opus-orchestra/core';

// ============================================================================
// VSCode-specific constants
// ============================================================================

/** VS Code configuration section name */
export const CONFIG_SECTION = 'claudeAgents';

/** Git Bash executable path on Windows */
export const GIT_BASH_PATH = 'C:\\Program Files\\Git\\bin\\bash.exe';

// ============================================================================
// VSCode-specific types (not in core)
// ============================================================================

// Webview UI types
export {
    formatTimeSince,
    AgentPanelMessageType,
    AgentPanelMessage,
} from './ui';
