/**
 * State machine definitions for complex state management
 *
 * These factory functions create pre-configured state machines for
 * agents, containers, and polling operations.
 */

import { StateMachine, StateMachineConfig } from '../utils/StateMachine';
import { AgentStatus } from './agent';
import { ContainerState } from './container';

// ============================================================================
// Agent State Machine
// ============================================================================

/**
 * Events that can trigger agent state transitions
 */
export type AgentEvent =
  | 'START' // Begin working
  | 'COMPLETE' // Finish task
  | 'REQUEST_INPUT' // Need user input
  | 'REQUEST_APPROVAL' // Need permission
  | 'RECEIVE_INPUT' // Got user input
  | 'APPROVE' // Permission granted
  | 'REJECT' // Permission denied
  | 'ERROR' // Error occurred
  | 'STOP' // User stopped
  | 'RECOVER'; // Recovery from error

/**
 * Create a state machine for managing agent lifecycle
 *
 * State transitions:
 * ```
 * idle ──START──> working ──COMPLETE──> idle
 *   │                │
 *   │                ├──REQUEST_INPUT──> waiting-input ──RECEIVE_INPUT──> working
 *   │                │
 *   │                ├──REQUEST_APPROVAL──> waiting-approval ──APPROVE──> working
 *   │                │                                       └──REJECT──> idle
 *   │                │
 *   │                ├──ERROR──> error ──RECOVER──> idle
 *   │                │
 *   │                └──STOP──> stopped ──START──> working
 *   │
 * stopped ──START──> working
 * error ──START──> working
 *       └──RECOVER──> idle
 * ```
 */
export function createAgentStateMachine(
  onTransition?: (from: AgentStatus, to: AgentStatus, event: AgentEvent) => void,
  onInvalidTransition?: (
    currentState: AgentStatus,
    event: AgentEvent,
    allowedFrom: AgentStatus[]
  ) => void
): StateMachine<AgentStatus, AgentEvent> {
  const config: StateMachineConfig<AgentStatus, AgentEvent> = {
    initial: 'idle',
    transitions: {
      START: { from: ['idle', 'stopped', 'error'], to: 'working' },
      COMPLETE: { from: 'working', to: 'idle' },
      REQUEST_INPUT: { from: 'working', to: 'waiting-input' },
      REQUEST_APPROVAL: { from: 'working', to: 'waiting-approval' },
      RECEIVE_INPUT: { from: 'waiting-input', to: 'working' },
      APPROVE: { from: 'waiting-approval', to: 'working' },
      REJECT: { from: 'waiting-approval', to: 'idle' },
      ERROR: { from: ['working', 'waiting-input', 'waiting-approval'], to: 'error' },
      STOP: { from: ['working', 'waiting-input', 'waiting-approval'], to: 'stopped' },
      RECOVER: { from: 'error', to: 'idle' },
    },
    onTransition,
    onInvalidTransition,
  };
  return new StateMachine(config);
}

/**
 * Map external status (from hooks) to state machine event
 */
export function mapStatusToAgentEvent(
  currentStatus: AgentStatus,
  newStatus: AgentStatus
): AgentEvent | null {
  // Same state - no event
  if (currentStatus === newStatus) {return null;}

  // Map based on target state
  switch (newStatus) {
    case 'working':
      if (currentStatus === 'waiting-input') {return 'RECEIVE_INPUT';}
      if (currentStatus === 'waiting-approval') {return 'APPROVE';}
      return 'START';
    case 'idle':
      if (currentStatus === 'working') {return 'COMPLETE';}
      if (currentStatus === 'waiting-approval') {return 'REJECT';}
      if (currentStatus === 'error') {return 'RECOVER';}
      return null;
    case 'waiting-input':
      return 'REQUEST_INPUT';
    case 'waiting-approval':
      return 'REQUEST_APPROVAL';
    case 'stopped':
      return 'STOP';
    case 'error':
      return 'ERROR';
    default:
      return null;
  }
}

// ============================================================================
// Container State Machine
// ============================================================================

/**
 * Events that can trigger container state transitions
 */
export type ContainerEvent =
  | 'CREATE' // Start creation
  | 'CREATED' // Creation complete
  | 'START' // Start container
  | 'STOP' // Stop container
  | 'FAIL' // Operation failed
  | 'DESTROY' // Remove container
  | 'RECOVER'; // Recover from error

/**
 * Create a state machine for managing container lifecycle
 *
 * State transitions:
 * ```
 * not_created ──CREATE──> creating ──CREATED──> running
 *      ^                      │                    │
 *      │                      └──FAIL──> error     │
 *      │                           │               │
 *      │                           └──RECOVER──────┤
 *      │                                           │
 *      └──DESTROY──────────────────────────────────┤
 *                                                  │
 *                              running ──STOP──> stopped
 *                                 ^                 │
 *                                 └───START─────────┘
 * ```
 */
export function createContainerStateMachine(
  onTransition?: (
    from: ContainerState,
    to: ContainerState,
    event: ContainerEvent
  ) => void,
  onInvalidTransition?: (
    currentState: ContainerState,
    event: ContainerEvent,
    allowedFrom: ContainerState[]
  ) => void
): StateMachine<ContainerState, ContainerEvent> {
  const config: StateMachineConfig<ContainerState, ContainerEvent> = {
    initial: 'not_created',
    transitions: {
      CREATE: { from: 'not_created', to: 'creating' },
      CREATED: { from: 'creating', to: 'running' },
      START: { from: 'stopped', to: 'running' },
      STOP: { from: 'running', to: 'stopped' },
      FAIL: { from: ['creating', 'running'], to: 'error' },
      DESTROY: { from: ['running', 'stopped', 'error'], to: 'not_created' },
      RECOVER: { from: 'error', to: 'not_created' },
    },
    onTransition,
    onInvalidTransition,
  };
  return new StateMachine(config);
}

// ============================================================================
// Polling State Machine
// ============================================================================

/**
 * Polling lifecycle states
 */
export type PollingState = 'idle' | 'polling' | 'paused' | 'stopping' | 'error';

/**
 * Events that can trigger polling state transitions
 */
export type PollingEvent =
  | 'START' // Begin polling
  | 'PAUSE' // Temporarily pause
  | 'RESUME' // Resume from pause
  | 'STOP' // Request stop
  | 'STOPPED' // Stop complete
  | 'FAIL' // Error occurred
  | 'RECOVER'; // Recover from error

/**
 * Create a state machine for managing polling lifecycle
 *
 * State transitions:
 * ```
 * idle ──START──> polling ──PAUSE──> paused ──RESUME──> polling
 *  ^                 │                  │
 *  │                 └──STOP──> stopping ──STOPPED──> idle
 *  │                 │           ^
 *  │                 └──FAIL──> error ──RECOVER──> idle
 *  │                                  └──STOP──> stopping
 *  └──STOPPED────────────────────────────────────────────┘
 * ```
 */
export function createPollingStateMachine(
  onTransition?: (
    from: PollingState,
    to: PollingState,
    event: PollingEvent
  ) => void,
  onInvalidTransition?: (
    currentState: PollingState,
    event: PollingEvent,
    allowedFrom: PollingState[]
  ) => void
): StateMachine<PollingState, PollingEvent> {
  const config: StateMachineConfig<PollingState, PollingEvent> = {
    initial: 'idle',
    transitions: {
      START: { from: 'idle', to: 'polling' },
      PAUSE: { from: 'polling', to: 'paused' },
      RESUME: { from: 'paused', to: 'polling' },
      STOP: { from: ['polling', 'paused', 'error'], to: 'stopping' },
      STOPPED: { from: 'stopping', to: 'idle' },
      FAIL: { from: 'polling', to: 'error' },
      RECOVER: { from: 'error', to: 'idle' },
    },
    onTransition,
    onInvalidTransition,
  };
  return new StateMachine(config);
}

/**
 * Check if polling is active (polling or paused)
 */
export function isPollingActive(state: PollingState): boolean {
  return state === 'polling' || state === 'paused';
}

/**
 * Check if polling can be started
 */
export function canStartPolling(state: PollingState): boolean {
  return state === 'idle';
}
