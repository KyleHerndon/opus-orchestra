/**
 * Opus Orchestra - Core Types
 *
 * Re-exports all types from their respective modules.
 */

// Agent types
export {
    AgentStatus,
    DiffStats,
    PersistedAgent,
    Agent,
    PendingApproval,
    AgentDisplayData,
    AGENT_NAMES,
    STATUS_ICONS,
    AGENTS_STORAGE_KEY,
} from './agent';

// Container types
export {
    IsolationTier,
    ContainerState,
    ContainerMount,
    ContainerConfig,
    ContainerInfo,
    PersistedContainerInfo,
    ISOLATION_TIER_DESCRIPTIONS,
    ISOLATION_TIER_ORDER,
    CONTAINER_LABELS,
    BLOCKED_HOST_PATHS,
    DEFAULT_CONTAINER_IMAGE,
    CONTAINERS_STORAGE_KEY,
    CONTAINER_RESOURCE_DEFAULTS,
    DEFAULT_PROXY_PORT,
} from './container';

// Terminal types
export {
    TerminalType,
    TerminalOptions,
    TERMINAL_DELAYS,
    GIT_BASH_PATH,
} from './terminal';

// Hook types
export {
    HookEventType,
    HookData,
    ParsedStatus,
} from './hooks';

// Configuration types
export {
    ExtensionConfig,
    DEFAULT_CONFIG,
    POLLING_DEFAULTS,
    CONFIG_SECTION,
} from './config';

// Service interfaces
export {
    IGitService,
    ITerminalService,
    IStatusService,
    IContainerService,
    IFileService,
    ICommandService,
    ILogger,
} from './services';

// Event types
export {
    EventType,
    EventPayloads,
    EventHandler,
    IEventBus,
} from './events';

// UI types and utilities
export {
    formatTimeSince,
    AgentPanelMessageType,
    AgentPanelMessage,
} from './ui';
