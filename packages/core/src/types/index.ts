/**
 * Core type definitions
 *
 * All types are platform-agnostic with no VS Code or OS-specific dependencies.
 */

// Agent types
export {
  AgentStatus,
  DiffStats,
  PersistedAgent,
  Agent,
  AgentTodoItem,
  PendingApproval,
  AgentDisplayData,
  AGENT_NAMES,
  STATUS_ICONS,
  AGENTS_STORAGE_KEY,
  AgentOrderMap,
  AGENT_ORDER_STORAGE_KEY,
} from './agent';

// Container types
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
} from './container';

// Event types
export {
  OperationType,
  OperationStatus,
  EventType,
  CommandPayloads,
  OperationPayloads,
  DomainEventPayloads,
  EventPayloads,
  EventHandler,
  IEventBus,
} from './events';

// Hook types
export {
  HookEventType,
  HookData,
  ParsedStatus,
} from './hooks';

// Result types (explicit error handling)
export {
  Result,
  Success,
  Failure,
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  map,
  GitErrorCode,
  FileErrorCode,
} from './result';

// Zod schemas for runtime validation
export {
  PersistedAgentSchema,
  ValidatedPersistedAgent,
  DiffStatsSchema,
  ValidatedDiffStats,
  AgentTodoItemSchema,
  ValidatedAgentTodoItem,
  HookEventTypeSchema,
  HookDataSchema,
  ValidatedHookData,
  // Config schemas
  TerminalTypeSchema,
  LogLevelSchema,
  ExtensionConfigSchema,
  ValidatedExtensionConfig,
  PartialExtensionConfigSchema,
  ValidatedPartialConfig,
  ConfigSchema, // Legacy alias
  // Container schemas
  ContainerConfigSchema,
  ValidatedContainerConfig,
  // Validation helpers
  safeParse,
  parse,
  formatZodError,
} from './schemas';
