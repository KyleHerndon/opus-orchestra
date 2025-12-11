/**
 * Event types for the EventBus
 */

import { Agent, AgentStatus, PendingApproval } from './agent';
import { ContainerInfo, ContainerState } from './container';

/**
 * Event types emitted by the extension
 */
export type EventType =
    | 'agent:created'
    | 'agent:deleted'
    | 'agent:statusChanged'
    | 'agent:renamed'
    | 'agent:terminalClosed'
    | 'container:created'
    | 'container:removed'
    | 'container:stateChanged'
    | 'approval:pending'
    | 'approval:resolved';

/**
 * Event payload types
 */
export interface EventPayloads {
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
}

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
