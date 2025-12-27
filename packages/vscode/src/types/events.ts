/**
 * Event types - re-exported from core
 *
 * Now that the vscode Agent type uses TerminalHandle from core,
 * we can directly use the core event types without local overrides.
 */

// Re-export all event types from core
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
