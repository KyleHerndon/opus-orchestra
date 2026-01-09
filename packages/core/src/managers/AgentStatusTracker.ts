/**
 * AgentStatusTracker - Tracks and updates agent status
 *
 * Platform-agnostic implementation using core services.
 * Polls hook-generated status files, TODOs, and diff stats.
 * Supports automatic polling with configurable intervals.
 */

import { Agent, PendingApproval, STATUS_ICONS } from '../types/agent';
import { IStatusService } from '../services/StatusService';
import { IGitService } from '../services/GitService';
import { ITodoService, TodoItem } from '../services/TodoService';
import { IEventBus } from '../types/events';
import { ConfigAdapter } from '../adapters/ConfigAdapter';
import { ILogger } from '../services/Logger';

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
  refreshStatus(agents: Map<number, Agent>): void;
  refreshTodos(agents: Map<number, Agent>): void;
  refreshDiffStats(agents: Map<number, Agent>): Promise<void>;
  updateAgentIcon(agent: Agent): void;
  getPendingApprovals(agents: Map<number, Agent>): PendingApproval[];
  getWaitingCount(agents: Map<number, Agent>): number;

  // Polling lifecycle
  startPolling(getAgents: () => Map<number, Agent>, config?: Partial<PollingConfig>): void;
  stopPolling(): void;
  isPolling(): boolean;
}

/**
 * Tracks and updates agent status from hook-generated files.
 * Responsible for polling status, TODOs, diff stats, and managing approvals.
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

  // Polling state
  private pollingIntervals: {
    status?: ReturnType<typeof setInterval>;
    todo?: ReturnType<typeof setInterval>;
    diff?: ReturnType<typeof setInterval>;
  } = {};
  private _isPolling = false;

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
    this.logger = logger?.child('AgentStatusTracker');
  }

  /**
   * Refresh status for all agents
   */
  refreshStatus(agents: Map<number, Agent>): void {
    this.logger?.debug(`refreshStatus called, agents count: ${agents.size}`);
    for (const agent of agents.values()) {
      this.checkHookStatus(agent);
      this.updateAgentIcon(agent);
    }
  }

  /**
   * Check hook-based status file for an agent
   */
  private checkHookStatus(agent: Agent): void {
    const parsedStatus = this.statusService.checkStatus(agent.worktreePath);
    if (parsedStatus) {
      const previousStatus = agent.status;
      const hadApproval = agent.pendingApproval !== null;

      agent.status = parsedStatus.status;
      agent.pendingApproval = parsedStatus.pendingApproval;

      // Emit status change event if status actually changed
      if (previousStatus !== agent.status) {
        this.eventBus.emit('agent:statusChanged', { agent, previousStatus });
      }

      // Emit approval pending event if new approval appeared
      if (!hadApproval && agent.pendingApproval !== null) {
        this.eventBus.emit('approval:pending', {
          approval: {
            agentId: agent.id,
            description: agent.pendingApproval,
            timestamp: new Date(),
          }
        });
      }
    }
  }

  /**
   * Refresh diff stats for all agents (async, for longer polling interval)
   */
  async refreshDiffStats(agents: Map<number, Agent>): Promise<void> {
    const diffInterval = this.config.get('diffPollingInterval');

    if (diffInterval === 0) {
      return;
    }

    const promises: Promise<void>[] = [];
    for (const agent of agents.values()) {
      promises.push(this.getDiffStatsAsync(agent));
    }

    await Promise.all(promises);
  }

  /**
   * Get diff stats for a single agent
   */
  private async getDiffStatsAsync(agent: Agent): Promise<void> {
    try {
      const baseBranch = await this.gitService.getBaseBranch(agent.repoPath);
      const previousDiffStats = { ...agent.diffStats };
      const newDiffStats = await this.gitService.getDiffStats(agent.worktreePath, baseBranch);

      // Check if diff stats changed
      if (
        previousDiffStats.insertions !== newDiffStats.insertions ||
        previousDiffStats.deletions !== newDiffStats.deletions ||
        previousDiffStats.filesChanged !== newDiffStats.filesChanged
      ) {
        agent.diffStats = newDiffStats;
        this.eventBus.emit('agent:diffStatsChanged', { agent, previousDiffStats });
      }
    } catch {
      // Keep existing stats on error
    }
  }

  /**
   * Update agent status icon based on current status
   */
  updateAgentIcon(agent: Agent): void {
    if (agent.status === 'idle') {
      agent.statusIcon = agent.terminal ? 'circle-filled' : 'circle-outline';
    } else {
      agent.statusIcon = STATUS_ICONS[agent.status];
    }
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
   * Refresh TODOs for all agents from Claude Code's ~/.claude/todos directory
   */
  refreshTodos(agents: Map<number, Agent>): void {
    if (!this.todoService) {
      return;
    }

    for (const agent of agents.values()) {
      if (!agent.sessionId) {
        continue;
      }

      const todoItems = this.todoService.getTodosForSession(agent.sessionId);
      if (todoItems) {
        const previousTodos = agent.todos;
        agent.todos = todoItems.map((item: TodoItem) => ({
          status: item.status,
          content: item.content,
          activeForm: item.activeForm,
        }));

        // Emit event if TODOs changed (check length first for efficiency)
        const todosChanged =
          previousTodos.length !== agent.todos.length ||
          JSON.stringify(previousTodos) !== JSON.stringify(agent.todos);
        if (todosChanged) {
          this.eventBus.emit('agent:todosChanged', { agent, previousTodos });
        }
      }
    }
  }

  /**
   * Start automatic polling for status, TODOs, and diff stats.
   * @param getAgents - Function that returns the current agents map
   * @param config - Optional polling configuration overrides
   */
  startPolling(
    getAgents: () => Map<number, Agent>,
    config?: Partial<PollingConfig>
  ): void {
    if (this._isPolling) {
      this.logger?.debug('Polling already running');
      return;
    }

    const pollingConfig = { ...DEFAULT_POLLING_CONFIG, ...config };
    this._isPolling = true;
    this.logger?.debug('Starting polling with config:', pollingConfig);

    // Status polling (fast interval)
    if (pollingConfig.statusInterval > 0) {
      const pollStatus = () => {
        const agents = getAgents();
        if (agents.size > 0) {
          this.refreshStatus(agents);
        }
      };
      this.pollingIntervals.status = setInterval(pollStatus, pollingConfig.statusInterval);
      pollStatus(); // Initial poll
    }

    // TODO polling (medium interval)
    if (pollingConfig.todoInterval > 0 && this.todoService) {
      const pollTodos = () => {
        const agents = getAgents();
        if (agents.size > 0) {
          this.refreshTodos(agents);
        }
      };
      this.pollingIntervals.todo = setInterval(pollTodos, pollingConfig.todoInterval);
      pollTodos(); // Initial poll
    }

    // Diff stats polling (slow interval)
    if (pollingConfig.diffInterval > 0) {
      const pollDiff = async () => {
        const agents = getAgents();
        if (agents.size > 0) {
          await this.refreshDiffStats(agents);
        }
      };
      this.pollingIntervals.diff = setInterval(pollDiff, pollingConfig.diffInterval);
      // Delayed initial poll for diff (less urgent)
      setTimeout(pollDiff, 1000);
    }
  }

  /**
   * Stop all polling
   */
  stopPolling(): void {
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
