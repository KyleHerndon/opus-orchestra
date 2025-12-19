/**
 * AgentStatusTracker - Tracks and updates agent status
 *
 * Platform-agnostic implementation using core services.
 * Polls hook-generated status files and updates agent state.
 */

import { Agent, PendingApproval, STATUS_ICONS } from '../types/agent';
import { IStatusService } from '../services/StatusService';
import { IGitService } from '../services/GitService';
import { IEventBus } from '../types/events';
import { ConfigAdapter } from '../adapters/ConfigAdapter';
import { ILogger } from '../services/Logger';

/**
 * Agent status tracker interface
 */
export interface IAgentStatusTracker {
  refreshStatus(agents: Map<number, Agent>): void;
  refreshDiffStats(agents: Map<number, Agent>): Promise<void>;
  updateAgentIcon(agent: Agent): void;
  getPendingApprovals(agents: Map<number, Agent>): PendingApproval[];
  getWaitingCount(agents: Map<number, Agent>): number;
}

/**
 * Tracks and updates agent status from hook-generated files.
 * Responsible for polling status, updating icons, and managing approvals.
 */
export class AgentStatusTracker implements IAgentStatusTracker {
  private statusService: IStatusService;
  private gitService: IGitService;
  private eventBus: IEventBus;
  private config: ConfigAdapter;
  private logger?: ILogger;

  constructor(
    statusService: IStatusService,
    gitService: IGitService,
    eventBus: IEventBus,
    config: ConfigAdapter,
    logger?: ILogger
  ) {
    this.statusService = statusService;
    this.gitService = gitService;
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
      agent.diffStats = await this.gitService.getDiffStats(agent.worktreePath, baseBranch);
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
}
