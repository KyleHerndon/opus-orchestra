/**
 * Event types for the EventBus
 *
 * Architecture:
 * - Commands: Intents from UI/user (what they want to do)
 * - Operations: Progress tracking (started/progress/completed/failed)
 * - Domain Events: What happened (agent:created, agent:deleted, etc.)
 *
 * All types are platform-agnostic with no VS Code dependencies.
 */

import { Agent, AgentStatus, AgentTodoItem, DiffStats, PendingApproval } from './agent';
import { ContainerInfo, ContainerState } from './container';

// ============================================================================
// Operation Types
// ============================================================================

/**
 * Types of operations that can be tracked
 */
export type OperationType =
  | 'createAgents'
  | 'deleteAgent'
  | 'renameAgent'
  | 'changeContainerConfig'
  | 'cleanup'
  | 'initProject'
  | 'initCoordination';

/**
 * Operation status
 */
export type OperationStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

// ============================================================================
// Event Types
// ============================================================================

/**
 * All event types emitted by the extension
 */
export type EventType =
  // Commands (user intents)
  | 'command:createAgents'
  | 'command:deleteAgent'
  | 'command:renameAgent'
  | 'command:startClaude'
  | 'command:sendToAgent'
  | 'command:focusAgent'
  | 'command:changeContainerConfig'
  | 'command:cleanup'
  // Operations (progress tracking)
  | 'operation:started'
  | 'operation:progress'
  | 'operation:completed'
  | 'operation:failed'
  // Domain events (what happened)
  | 'agent:created'
  | 'agent:deleted'
  | 'agent:statusChanged'
  | 'agent:todosChanged'
  | 'agent:diffStatsChanged'
  | 'agent:renamed'
  | 'agent:terminalCreated'
  | 'agent:terminalClosed'
  | 'container:created'
  | 'container:removed'
  | 'container:stateChanged'
  | 'approval:pending'
  | 'approval:resolved'
  | 'status:refreshed'
  | 'diffStats:refreshed'
  // Error events (for error reporting)
  | 'error:recoverable'
  | 'error:fatal';

// ============================================================================
// Command Payloads
// ============================================================================

export interface CommandPayloads {
  'command:createAgents': {
    count: number;
    repoPath?: string;
    /** Container config name (e.g., 'unisolated', 'repo:dev') */
    containerConfigName?: string;
  };
  'command:deleteAgent': {
    agentId: number;
  };
  'command:renameAgent': {
    agentId: number;
    newName: string;
  };
  'command:startClaude': {
    agentId: number;
  };
  'command:sendToAgent': {
    agentId: number;
    text: string;
  };
  'command:focusAgent': {
    agentId: number;
  };
  'command:changeContainerConfig': {
    agentId: number;
    /** Container config name (e.g., 'unisolated', 'repo:dev') */
    configName: string;
  };
  'command:cleanup': Record<string, never>;
}

// ============================================================================
// Operation Payloads
// ============================================================================

export interface OperationPayloads {
  'operation:started': {
    operationId: string;
    type: OperationType;
    message: string;
  };
  'operation:progress': {
    operationId: string;
    type: OperationType;
    current: number;
    total: number;
    message: string;
  };
  'operation:completed': {
    operationId: string;
    type: OperationType;
    message?: string;
  };
  'operation:failed': {
    operationId: string;
    type: OperationType;
    error: string;
  };
}

// ============================================================================
// Domain Event Payloads
// ============================================================================

export interface DomainEventPayloads {
  'agent:created': { agent: Agent };
  'agent:deleted': { agentId: number };
  'agent:statusChanged': { agent: Agent; previousStatus: AgentStatus };
  'agent:todosChanged': { agent: Agent; previousTodos: AgentTodoItem[] };
  'agent:diffStatsChanged': { agent: Agent; previousDiffStats: DiffStats };
  'agent:renamed': { agent: Agent; previousName: string };
  'agent:terminalCreated': { agent: Agent; isNew: boolean };
  'agent:terminalClosed': { agentId: number };
  'container:created': { containerInfo: ContainerInfo };
  'container:removed': { agentId: number };
  'container:stateChanged': { containerInfo: ContainerInfo; previousState: ContainerState };
  'approval:pending': { approval: PendingApproval };
  'approval:resolved': { agentId: number };
  'status:refreshed': Record<string, never>;
  'diffStats:refreshed': Record<string, never>;
  // Error events
  'error:recoverable': {
    /** Component/service that raised the error */
    source: string;
    /** Error code for programmatic handling */
    code: string;
    /** Human-readable error message */
    message: string;
    /** What was done to recover (if anything) */
    recoveryAction?: string;
    /** Additional context for debugging */
    context?: Record<string, unknown>;
  };
  'error:fatal': {
    /** Component/service that raised the error */
    source: string;
    /** Error code for programmatic handling */
    code: string;
    /** Human-readable error message */
    message: string;
    /** Message safe to show to the user */
    userMessage: string;
    /** Additional context for debugging */
    context?: Record<string, unknown>;
  };
}

// ============================================================================
// Combined Event Payloads
// ============================================================================

/**
 * All event payload types combined
 */
export type EventPayloads = CommandPayloads & OperationPayloads & DomainEventPayloads;

/**
 * Event handler type
 */
export type EventHandler<T extends EventType> = (payload: EventPayloads[T]) => void;

/**
 * Event bus service interface
 */
export interface IEventBus {
  on<T extends EventType>(event: T, handler: EventHandler<T>): void;
  off<T extends EventType>(event: T, handler: EventHandler<T>): void;
  emit<T extends EventType>(event: T, payload: EventPayloads[T]): void;
}
