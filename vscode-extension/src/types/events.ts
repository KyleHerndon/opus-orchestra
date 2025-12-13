/**
 * Event types for the EventBus
 *
 * Architecture:
 * - Commands: Intents from UI/user (what they want to do)
 * - Operations: Progress tracking (started/progress/completed/failed)
 * - Domain Events: What happened (agent:created, agent:deleted, etc.)
 */

import { Agent, AgentStatus, PendingApproval } from './agent';
import { ContainerInfo, ContainerState, IsolationTier } from './container';

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
    | 'changeIsolationTier'
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
    | 'command:changeIsolationTier'
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
    | 'agent:renamed'
    | 'agent:terminalClosed'
    | 'container:created'
    | 'container:removed'
    | 'container:stateChanged'
    | 'approval:pending'
    | 'approval:resolved'
    | 'status:refreshed'
    | 'diffStats:refreshed';

// ============================================================================
// Command Payloads
// ============================================================================

export interface CommandPayloads {
    'command:createAgents': {
        count: number;
        repoPath?: string;
        isolationTier?: IsolationTier;
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
    'command:changeIsolationTier': {
        agentId: number;
        tier: IsolationTier;
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
    'agent:renamed': { agent: Agent; previousName: string };
    'agent:terminalClosed': { agentId: number };
    'container:created': { containerInfo: ContainerInfo };
    'container:removed': { agentId: number };
    'container:stateChanged': { containerInfo: ContainerInfo; previousState: ContainerState };
    'approval:pending': { approval: PendingApproval };
    'approval:resolved': { agentId: number };
    'status:refreshed': Record<string, never>;
    'diffStats:refreshed': Record<string, never>;
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
