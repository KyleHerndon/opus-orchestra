/**
 * VSCode-specific event payload types
 *
 * This file defines EventPayloads that match what the vscode code actually emits.
 * Uses the VSCode-specific Agent type (with vscode.Terminal).
 *
 * TODO: When vscode Agent is migrated to use TerminalHandle, align with core.
 */

import { Agent } from './agent';
import {
    AgentStatus,
    ContainerInfo,
    ContainerState,
    EventType,
    OperationType,
} from '@opus-orchestra/core';

// Re-export core event types (except IEventBus/EventHandler which we define locally)
export {
    EventType,
    OperationType,
    OperationStatus,
} from '@opus-orchestra/core';

/**
 * Pending approval info
 */
export interface PendingApprovalInfo {
    agentId: number;
    description: string | null;
    timestamp: Date;
}

/**
 * Command payloads (user intents)
 */
export interface CommandPayloads {
    'command:createAgents': { count: number; repoPath: string; containerConfigName?: string };
    'command:deleteAgent': { agentId: number };
    'command:renameAgent': { agentId: number; newName: string };
    'command:startClaude': { agentId: number };
    'command:sendToAgent': { agentId: number; text: string };
    'command:focusAgent': { agentId: number };
    'command:changeContainerConfig': { agentId: number; newConfigName: string };
    'command:cleanup': Record<string, never>;
}

/**
 * Operation payloads (progress tracking)
 */
export interface OperationPayloads {
    'operation:started': { operationId: string; type: OperationType; message: string };
    'operation:progress': { operationId: string; type: OperationType; message: string; current?: number; total?: number; percent?: number };
    'operation:completed': { operationId: string; type: OperationType; message?: string };
    'operation:failed': { operationId: string; type: OperationType; error: string };
}

/**
 * Domain event payloads - uses vscode Agent
 */
export interface DomainEventPayloads {
    'agent:created': { agent: Agent };
    'agent:deleted': { agentId: number };
    'agent:statusChanged': { agent: Agent; previousStatus: AgentStatus };
    'agent:renamed': { agent: Agent; previousName: string };
    'agent:terminalCreated': { agent: Agent; isNew?: boolean };
    'agent:terminalClosed': { agentId: number };
    'container:created': { containerInfo: ContainerInfo };
    'container:removed': { agentId: number };
    'container:stateChanged': { agentId: number; oldState: ContainerState; newState: ContainerState };
    'approval:pending': { approval: PendingApprovalInfo };
    'approval:resolved': { agentId: number };
    'status:refreshed': Record<string, never>;
    'diffStats:refreshed': Record<string, never>;
}

/**
 * Combined event payloads
 */
export interface EventPayloads extends CommandPayloads, OperationPayloads, DomainEventPayloads {}

/**
 * Event handler function type - uses local EventPayloads with vscode Agent
 */
export type EventHandler<T extends EventType> = (payload: EventPayloads[T]) => void;

/**
 * EventBus interface - uses local EventPayloads with vscode Agent
 */
export interface IEventBus {
    on<T extends EventType>(event: T, handler: EventHandler<T>): void;
    off<T extends EventType>(event: T, handler: EventHandler<T>): void;
    emit<T extends EventType>(event: T, payload: EventPayloads[T]): void;
    once<T extends EventType>(event: T, handler: EventHandler<T>): void;
}
