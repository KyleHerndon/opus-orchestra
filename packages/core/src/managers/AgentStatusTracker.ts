/**
 * AgentStatusTracker - Tracks and updates agent status
 *
 * Platform-agnostic implementation using core services.
 * Uses hybrid file watching (chokidar + polling fallback) for status updates.
 * Polls TODOs and diff stats on configurable intervals.
 *
 * Reliability features:
 * - Immutable agent updates (no in-place mutation)
 * - Mutex protection for concurrent updates
 * - Snapshot iteration for safe traversal
 * - Unified file watching with polling fallback
 */

import { Mutex } from 'async-mutex';
import { Agent, AgentStatus, PendingApproval, STATUS_ICONS } from '../types/agent';
import { IStatusService } from '../services/StatusService';
import { IGitService } from '../services/GitService';
import { ITodoService, TodoItem } from '../services/TodoService';
import { IEventBus } from '../types/events';
import { ConfigAdapter } from '../adapters/ConfigAdapter';
import { ILogger } from '../services/Logger';
import { FileWatcher, IFileWatcher, FileWatchEvent } from '../utils/FileWatcher';
import { StateMachine } from '../utils/StateMachine';
import { AgentEvent, createAgentStateMachine, mapStatusToAgentEvent } from '../types/stateMachines';
import {
  updateAgent,
  snapshotAgents,
  diffStatsEqual,
  todosEqual,
  AgentUpdate,
} from '../utils/agentUpdates';

/**
 * Polling configuration
 */
export interface PollingConfig {
  statusInterval: number;    // Status polling interval in ms (default: 1000)
  todoInterval: number;      // TODO polling interval in ms (default: 2000)
  diffInterval: number;      // Diff stats polling interval in ms (default: 60000)
}

/**
 * Default polling configuration
 */
export const DEFAULT_POLLING_CONFIG: PollingConfig = {
  statusInterval: 1000,
  todoInterval: 2000,
  diffInterval: 60000,
};

/**
 * Agent status tracker interface
 */
export interface IAgentStatusTracker {
  refreshStatus(agents: Map<number, Agent>): Promise<void>;
  refreshTodos(agents: Map<number, Agent>): Promise<void>;
  refreshDiffStats(agents: Map<number, Agent>): Promise<void>;
  updateAgentIcon(agent: Agent): Promise<void>;
  getPendingApprovals(agents: Map<number, Agent>): PendingApproval[];
  getWaitingCount(agents: Map<number, Agent>): number;

  // Polling lifecycle
  startPolling(
    getAgents: () => Map<number, Agent>,
    onAgentUpdate: AgentUpdateCallback,
    config?: Partial<PollingConfig>
  ): void;
  stopPolling(): void;
  isPolling(): boolean;

  // File watcher health
  isWatcherHealthy(): boolean;

  // Agent lifecycle
  cleanupAgent(agentId: number): void;
}

/**
 * Callback for applying agent updates to the owner's map
 */
export type AgentUpdateCallback = (agentId: number, updatedAgent: Agent) => void;

/**
 * Tracks and updates agent status from hook-generated files.
 * Responsible for polling status, TODOs, diff stats, and managing approvals.
 *
 * IMPORTANT: This class does NOT own the agents map. It receives agents,
 * computes updates, and calls back with the updated agent. The caller
 * is responsible for storing the updated agent in their map.
 */
export class AgentStatusTracker implements IAgentStatusTracker {
  // Services
  private statusService: IStatusService;
  private gitService: IGitService;
  private todoService?: ITodoService;

  // Infrastructure
  private eventBus: IEventBus;
  private config: ConfigAdapter;
  private logger?: ILogger;

  // Mutex for serializing status updates (prevents race conditions)
  private updateMutex: Mutex;

  // Polling state
  private pollingIntervals: {
    status?: ReturnType<typeof setInterval>;
    todo?: ReturnType<typeof setInterval>;
    diff?: ReturnType<typeof setInterval>;
  } = {};
  // Track the initial diff timeout separately (it's a setTimeout, not setInterval)
  private initialDiffTimeout?: ReturnType<typeof setTimeout>;
  private _isPolling = false;

  // Abort controller for cancelling in-flight async operations
  private abortController: AbortController | null = null;

  // File watcher for status directories (chokidar + polling fallback)
  private statusWatcher: IFileWatcher | null = null;
  // File watcher for worktree directories (triggers diff refresh)
  private worktreeWatcher: IFileWatcher | null = null;
  // Cache of getAgents function for use by file watcher callbacks
  private getAgentsCallback: (() => Map<number, Agent>) | null = null;
  // Callback for applying updates to the owner's agent map
  private onAgentUpdate: AgentUpdateCallback | null = null;

  // State machines for validating agent status transitions
  private agentStateMachines: Map<number, StateMachine<AgentStatus, AgentEvent>> = new Map();

  constructor(
    statusService: IStatusService,
    gitService: IGitService,
    todoService: ITodoService | undefined,
    eventBus: IEventBus,
    config: ConfigAdapter,
    logger?: ILogger
  ) {
    this.statusService = statusService;
    this.gitService = gitService;
    this.todoService = todoService;
    this.eventBus = eventBus;
    this.config = config;
    this.logger = logger?.child({ component: 'AgentStatusTracker' });
    this.updateMutex = new Mutex();
  }

  /**
   * Get or create a state machine for an agent
   */
  private getStateMachine(agent: Agent): StateMachine<AgentStatus, AgentEvent> {
    let machine = this.agentStateMachines.get(agent.id);
    if (!machine) {
      machine = createAgentStateMachine(
        (from, to, event) => {
          this.logger?.debug(`Agent ${agent.name}: ${from} -> ${to} via ${event}`);
        },
        (state, event, allowed) => {
          this.logger?.warn(
            `Invalid transition for ${agent.name}: ${event} from ${state}, allowed from: ${allowed.join(', ')}`
          );
        }
      );
      // Sync to current agent status
      if (agent.status !== 'idle') {
        machine.forceState(agent.status);
      }
      this.agentStateMachines.set(agent.id, machine);
    }
    return machine;
  }

  /**
   * Validate and apply a status transition using the state machine.
   * Ensures state machine is synced with agent's current status before validation.
   * Returns the validated status - REJECTS invalid transitions (returns current state).
   */
  private validateStatusTransition(agent: Agent, newStatus: AgentStatus): AgentStatus {
    const machine = this.getStateMachine(agent);

    // Sync state machine with agent's current status if they've drifted
    // This handles cases where status was changed outside the tracker
    if (machine.state !== agent.status) {
      this.logger?.debug(
        `State machine drift detected for ${agent.name}: machine=${machine.state}, agent=${agent.status}. Syncing.`
      );
      machine.forceState(agent.status);
    }

    const event = mapStatusToAgentEvent(machine.state, newStatus);

    if (!event) {
      // Same state or unmapped transition
      return machine.state;
    }

    if (machine.canTransition(event)) {
      machine.transition(event);
      return newStatus;
    } else {
      // Invalid transition - REJECT and keep current state
      this.logger?.warn(
        `Rejecting invalid transition for ${agent.name}: ${machine.state} -> ${newStatus} via ${event}`
      );
      // Emit recoverable error so UI can surface this if needed
      this.eventBus.emit('error:recoverable', {
        source: 'AgentStatusTracker',
        code: 'INVALID_STATE_TRANSITION',
        message: `Invalid status transition for agent ${agent.name}`,
        context: {
          agentId: agent.id,
          agentName: agent.name,
          fromStatus: machine.state,
          toStatus: newStatus,
          event,
        },
      });
      return machine.state; // Keep current state - don't force invalid state
    }
  }

  /**
   * Clean up state machine when an agent is deleted
   */
  cleanupAgent(agentId: number): void {
    this.agentStateMachines.delete(agentId);
  }

  /**
   * Refresh status for all agents.
   * Uses mutex to prevent concurrent updates, snapshot iteration for safety.
   */
  async refreshStatus(agents: Map<number, Agent>): Promise<void> {
    await this.updateMutex.runExclusive(() => {
      this.logger?.debug(`refreshStatus called, agents count: ${agents.size}`);
      // Snapshot to prevent issues if map is modified during iteration
      const agentSnapshot = snapshotAgents(agents);
      for (const agent of agentSnapshot) {
        this.updateAgentStatus(agent);
      }
    });
  }

  /**
   * Update agent status, icon, and approval using immutable updates.
   * Creates a new agent object and notifies via callback.
   */
  private updateAgentStatus(agent: Agent): void {
    const parsedStatus = this.statusService.checkStatus(agent.worktreePath);
    if (!parsedStatus) {
      // No status update, but still update icon in case terminal state changed
      const newIcon = this.computeStatusIcon(agent.status, agent.terminal !== null);
      if (newIcon !== agent.statusIcon) {
        const updatedAgent = updateAgent(agent, { statusIcon: newIcon });
        this.applyAgentUpdate(updatedAgent);
      }
      return;
    }

    // Capture previous state for event emission
    const previousStatus = agent.status;
    const hadApproval = agent.pendingApproval !== null;

    // Validate status transition via state machine
    const validatedStatus = this.validateStatusTransition(agent, parsedStatus.status);
    const newIcon = this.computeStatusIcon(validatedStatus, agent.terminal !== null);

    // Create immutable update
    const updates: AgentUpdate = {
      status: validatedStatus,
      statusIcon: newIcon,
      pendingApproval: parsedStatus.pendingApproval,
      lastInteractionTime: new Date(),
    };

    const updatedAgent = updateAgent(agent, updates);

    // Apply update via callback (caller updates their map)
    this.applyAgentUpdate(updatedAgent);

    // Now emit events (after update is applied)
    if (previousStatus !== validatedStatus) {
      this.eventBus.emit('agent:statusChanged', { agent: updatedAgent, previousStatus });
    }

    if (!hadApproval && parsedStatus.pendingApproval !== null) {
      this.eventBus.emit('approval:pending', {
        approval: {
          agentId: updatedAgent.id,
          description: parsedStatus.pendingApproval,
          timestamp: new Date(),
        }
      });
    }
  }

  /**
   * Compute the status icon for a given status
   */
  private computeStatusIcon(status: AgentStatus, hasTerminal: boolean): string {
    if (status === 'idle') {
      return hasTerminal ? 'circle-filled' : 'circle-outline';
    }
    return STATUS_ICONS[status];
  }

  /**
   * Apply an agent update via callback
   */
  private applyAgentUpdate(updatedAgent: Agent): void {
    if (this.onAgentUpdate) {
      this.onAgentUpdate(updatedAgent.id, updatedAgent);
    }
  }

  /**
   * Refresh diff stats for all agents (async, for longer polling interval)
   * Uses abort controller to cancel in-flight operations when polling stops.
   * Uses mutex to prevent concurrent diff refreshes.
   */
  async refreshDiffStats(agents: Map<number, Agent>): Promise<void> {
    const diffInterval = this.config.get('diffPollingInterval');

    if (diffInterval === 0) {
      return;
    }

    // Use mutex to prevent concurrent diff refreshes
    await this.updateMutex.runExclusive(async () => {
      // Get abort signal for this batch (may be null if polling stopped)
      const signal = this.abortController?.signal;

      // Snapshot for safe iteration
      const agentSnapshot = snapshotAgents(agents);

      const promises: Promise<void>[] = [];
      for (const agent of agentSnapshot) {
        // Check if cancelled before starting each agent
        if (signal?.aborted) {
          this.logger?.debug('refreshDiffStats cancelled');
          return;
        }
        promises.push(this.getDiffStatsAsync(agent, signal));
      }

      await Promise.all(promises);
    });
  }

  /**
   * Get diff stats for a single agent (with cancellation support)
   * Uses immutable updates.
   */
  private async getDiffStatsAsync(agent: Agent, signal?: AbortSignal): Promise<void> {
    // Check cancellation before starting
    if (signal?.aborted) {return;}

    try {
      const baseBranch = await this.gitService.getBaseBranch(agent.repoPath);

      // Check cancellation after async operation
      if (signal?.aborted) {return;}

      const previousDiffStats = { ...agent.diffStats };
      const newDiffStats = await this.gitService.getDiffStats(agent.worktreePath, baseBranch);

      // Check cancellation before applying update
      if (signal?.aborted) {return;}

      // Check if diff stats changed using helper
      if (!diffStatsEqual(previousDiffStats, newDiffStats)) {
        // Create immutable update
        const updatedAgent = updateAgent(agent, { diffStats: newDiffStats });
        this.applyAgentUpdate(updatedAgent);
        this.eventBus.emit('agent:diffStatsChanged', { agent: updatedAgent, previousDiffStats });
      }
    } catch (err) {
      // Only log if not cancelled
      if (!signal?.aborted) {
        this.logger?.debug(
          { err: err instanceof Error ? err : new Error(String(err)) },
          `Failed to get diff stats for agent ${agent.name}`
        );
      }
    }
  }

  /**
   * Update agent status icon based on current status.
   * Uses mutex to prevent concurrent updates.
   */
  async updateAgentIcon(agent: Agent): Promise<void> {
    await this.updateMutex.runExclusive(() => {
      const newIcon = this.computeStatusIcon(agent.status, agent.terminal !== null);
      if (newIcon !== agent.statusIcon) {
        const updatedAgent = updateAgent(agent, { statusIcon: newIcon });
        this.applyAgentUpdate(updatedAgent);
      }
    });
  }

  /**
   * Get all pending approvals across agents
   */
  getPendingApprovals(agents: Map<number, Agent>): PendingApproval[] {
    const approvals: PendingApproval[] = [];
    for (const agent of agents.values()) {
      if (agent.pendingApproval) {
        approvals.push({
          agentId: agent.id,
          description: agent.pendingApproval,
          timestamp: new Date()
        });
      }
    }
    return approvals;
  }

  /**
   * Count agents waiting for input or approval
   */
  getWaitingCount(agents: Map<number, Agent>): number {
    let count = 0;
    for (const agent of agents.values()) {
      if (agent.status === 'waiting-input' || agent.status === 'waiting-approval') {
        count++;
      }
    }
    return count;
  }

  /**
   * Refresh TODOs for all agents from Claude Code's ~/.claude/todos directory.
   * Uses mutex to prevent concurrent updates, snapshot iteration and immutable updates.
   */
  async refreshTodos(agents: Map<number, Agent>): Promise<void> {
    if (!this.todoService) {
      return;
    }

    await this.updateMutex.runExclusive(() => {
      // Snapshot for safe iteration
      const agentSnapshot = snapshotAgents(agents);

      for (const agent of agentSnapshot) {
        if (!agent.sessionId) {
          continue;
        }

        const todoItems = this.todoService!.getTodosForSession(agent.sessionId);
        if (todoItems) {
          const previousTodos = agent.todos;
          const newTodos = todoItems.map((item: TodoItem) => ({
            status: item.status,
            content: item.content,
            activeForm: item.activeForm,
          }));

          // Check if TODOs changed using helper
          if (!todosEqual(previousTodos, newTodos)) {
            // Create immutable update
            const updatedAgent = updateAgent(agent, { todos: newTodos });
            this.applyAgentUpdate(updatedAgent);
            this.eventBus.emit('agent:todosChanged', { agent: updatedAgent, previousTodos });
          }
        }
      }
    });
  }

  /**
   * Start automatic polling for status, TODOs, and diff stats.
   * Uses hybrid file watching for status (chokidar + polling fallback).
   * @param getAgents - Function that returns the current agents map
   * @param onAgentUpdate - Callback to apply agent updates to the owner's map
   * @param config - Optional polling configuration overrides
   */
  startPolling(
    getAgents: () => Map<number, Agent>,
    onAgentUpdate: AgentUpdateCallback,
    config?: Partial<PollingConfig>
  ): void {
    // Guard: if already polling, don't create duplicate intervals
    if (this._isPolling) {
      this.logger?.debug('Polling already running');
      return;
    }

    // Safety: clear any stale intervals that might exist (defensive)
    this.clearAllIntervals();
    this.stopAllWatchers();

    // Create new abort controller for this polling session
    this.abortController = new AbortController();

    const pollingConfig = { ...DEFAULT_POLLING_CONFIG, ...config };
    this._isPolling = true;
    this.getAgentsCallback = getAgents;
    this.onAgentUpdate = onAgentUpdate;
    this.logger?.debug(pollingConfig, 'Starting polling with config');

    // Start file watcher for status directories
    this.startStatusWatcher(getAgents);

    // Start file watcher for worktree directories (triggers diff refresh)
    this.startWorktreeWatcher(getAgents);

    // TODO polling (medium interval) - file watcher handles status
    if (pollingConfig.todoInterval > 0 && this.todoService) {
      const pollTodos = async () => {
        const agents = getAgents();
        if (agents.size > 0) {
          await this.refreshTodos(agents);
        }
      };
      this.pollingIntervals.todo = setInterval(() => {
        pollTodos().catch((err) => {
          this.logger?.debug({ err }, 'Failed to poll todos');
        });
      }, pollingConfig.todoInterval);
      pollTodos().catch((err) => {
        this.logger?.debug({ err }, 'Failed to poll todos (initial)');
      }); // Initial poll
    }

    // Diff stats fallback polling (only if diffInterval > 0, worktree watcher is primary)
    if (pollingConfig.diffInterval > 0) {
      const pollDiff = async () => {
        const agents = getAgents();
        if (agents.size > 0) {
          await this.refreshDiffStats(agents);
        }
      };
      this.pollingIntervals.diff = setInterval(pollDiff, pollingConfig.diffInterval);
      // Delayed initial poll for diff - track the timeout so we can clear it
      this.initialDiffTimeout = setTimeout(pollDiff, 1000);
    }

    // Do initial status refresh
    const agents = getAgents();
    if (agents.size > 0) {
      this.refreshStatus(agents).catch((err) => {
        this.logger?.debug({ err }, 'Failed to do initial status refresh');
      });
    }
  }

  /**
   * Start the file watcher for status directories
   */
  private startStatusWatcher(getAgents: () => Map<number, Agent>): void {
    const agents = getAgents();
    const watchPaths = this.getStatusWatchPaths(agents);

    if (watchPaths.length === 0) {
      this.logger?.debug('No status directories to watch');
      return;
    }

    this.statusWatcher = new FileWatcher({
      paths: watchPaths,
      onEvent: (event: FileWatchEvent) => {
        this.handleStatusWatchEvent(event);
      },
      onError: (error: Error) => {
        this.logger?.warn({ err: error }, 'Status watcher error');
      },
      logger: this.logger,
      pollInterval: 5000,
      healthCheckInterval: 30000,
    });

    this.statusWatcher.start().catch((error) => {
      this.logger?.warn({ err: error }, 'Failed to start status watcher');
    });
  }

  /**
   * Start the file watcher for worktree directories (triggers diff refresh)
   */
  private startWorktreeWatcher(getAgents: () => Map<number, Agent>): void {
    const agents = getAgents();
    const watchPaths: string[] = [];

    for (const agent of agents.values()) {
      watchPaths.push(agent.worktreePath);
    }

    if (watchPaths.length === 0) {
      this.logger?.debug('No worktree directories to watch');
      return;
    }

    this.worktreeWatcher = new FileWatcher({
      paths: watchPaths,
      onEvent: (event: FileWatchEvent) => {
        this.handleWorktreeWatchEvent(event);
      },
      onError: (error: Error) => {
        this.logger?.warn({ err: error }, 'Worktree watcher error');
      },
      logger: this.logger,
      // Longer debounce - files change frequently during edits
      debounceMs: 500,
      // Less frequent health check for worktree watcher
      healthCheckInterval: 60000,
    });

    this.worktreeWatcher.start().catch((error) => {
      this.logger?.warn({ err: error }, 'Failed to start worktree watcher');
    });
  }

  /**
   * Stop all file watchers
   */
  private stopAllWatchers(): void {
    if (this.statusWatcher) {
      this.statusWatcher.stop();
      this.statusWatcher = null;
    }
    if (this.worktreeWatcher) {
      this.worktreeWatcher.stop();
      this.worktreeWatcher = null;
    }
  }

  /**
   * Get status directory paths for all agents
   */
  private getStatusWatchPaths(agents: Map<number, Agent>): string[] {
    const paths: string[] = [];
    for (const agent of agents.values()) {
      const statusDir = this.statusService.getStatusDirectory(agent.worktreePath);
      paths.push(statusDir);
    }
    return paths;
  }

  /**
   * Handle status file watch events.
   * All updates go through refreshStatus which uses mutex.
   */
  private handleStatusWatchEvent(event: FileWatchEvent): void {
    if (!this.getAgentsCallback) {
      return;
    }

    const agents = this.getAgentsCallback();
    if (agents.size === 0) {
      return;
    }

    // All events trigger a status refresh - mutex ensures serialization
    this.refreshStatus(agents).catch((err) => {
      this.logger?.debug({ err }, 'Failed to refresh status on watch event');
    });
  }

  /**
   * Handle worktree file watch events (triggers diff refresh).
   * Uses refreshDiffStats which acquires mutex.
   */
  private handleWorktreeWatchEvent(event: FileWatchEvent): void {
    if (!this.getAgentsCallback) {
      return;
    }

    // Skip internal directories that don't affect diffs
    if (event.path.includes('/.git/') ||
        event.path.includes('/node_modules/') ||
        event.path.includes('/.opus-orchestra/')) {
      return;
    }

    const agents = this.getAgentsCallback();
    if (agents.size === 0) {
      return;
    }

    if (event.type === 'error') {
      return;
    }

    // All file events trigger a diff refresh - mutex ensures serialization
    this.refreshDiffStats(agents).catch((err) => {
      this.logger?.debug({ err }, 'Failed to refresh diff stats on watch event');
    });
  }

  /**
   * Check if the file watcher is healthy
   */
  isWatcherHealthy(): boolean {
    return this.statusWatcher?.isHealthy() ?? true;
  }

  /**
   * Clear all polling intervals and timeouts (helper method)
   */
  private clearAllIntervals(): void {
    if (this.pollingIntervals.status) {
      clearInterval(this.pollingIntervals.status);
      this.pollingIntervals.status = undefined;
    }
    if (this.pollingIntervals.todo) {
      clearInterval(this.pollingIntervals.todo);
      this.pollingIntervals.todo = undefined;
    }
    if (this.pollingIntervals.diff) {
      clearInterval(this.pollingIntervals.diff);
      this.pollingIntervals.diff = undefined;
    }
    // Clear the initial diff timeout if it hasn't fired yet
    if (this.initialDiffTimeout) {
      clearTimeout(this.initialDiffTimeout);
      this.initialDiffTimeout = undefined;
    }
  }

  /**
   * Stop all polling, file watching, and cancel in-flight operations
   */
  stopPolling(): void {
    // Cancel any in-flight async operations (e.g., refreshDiffStats)
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Stop all file watchers
    this.stopAllWatchers();

    // Clear all intervals
    this.clearAllIntervals();

    // Clear callback references
    this.getAgentsCallback = null;
    this.onAgentUpdate = null;

    this._isPolling = false;
    this.logger?.debug('Polling stopped');
  }

  /**
   * Check if polling is currently active
   */
  isPolling(): boolean {
    return this._isPolling;
  }
}
