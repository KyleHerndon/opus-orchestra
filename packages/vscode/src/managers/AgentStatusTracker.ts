import { Agent, PendingApproval, STATUS_ICONS } from '../types';
import {
    getConfigService,
    getGitService,
    getStatusService,
    getEventBus,
    getLogger,
    isLoggerInitialized,
} from '../services';

/**
 * Tracks and updates agent status from hook-generated files.
 * Responsible for polling status, updating icons, and managing approvals.
 */
export class AgentStatusTracker {
    private debugLog(message: string): void {
        if (isLoggerInitialized()) {
            getLogger().child('AgentStatusTracker').debug(message);
        }
    }

    /**
     * Refresh status for all agents
     */
    refreshStatus(agents: Map<number, Agent>): void {
        this.debugLog(`[refreshStatus] called, agents count: ${agents.size}`);
        for (const agent of agents.values()) {
            this.checkHookStatus(agent);
            this.updateAgentIcon(agent);
        }
    }

    /**
     * Check hook-based status file for an agent
     */
    checkHookStatus(agent: Agent): void {
        const parsedStatus = getStatusService().checkStatus(agent.worktreePath);
        if (parsedStatus) {
            const previousStatus = agent.status;
            const hadApproval = agent.pendingApproval !== null;

            agent.status = parsedStatus.status;
            agent.pendingApproval = parsedStatus.pendingApproval;

            // Emit status change event if status actually changed
            if (previousStatus !== agent.status) {
                getEventBus().emit('agent:statusChanged', { agent, previousStatus });
            }

            // Emit approval pending event if new approval appeared
            if (!hadApproval && agent.pendingApproval !== null) {
                getEventBus().emit('approval:pending', {
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
        const diffInterval = getConfigService().diffPollingInterval;

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
            const gitService = getGitService();
            const baseBranch = await gitService.getBaseBranch(agent.repoPath);
            agent.diffStats = await gitService.getDiffStats(agent.worktreePath, baseBranch);
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
