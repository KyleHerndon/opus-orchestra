/**
 * StatusWatcher - Centralized status polling that emits events
 *
 * Polls agent status files and emits EventBus events when changes are detected.
 * This allows UI components to subscribe to events instead of being manually refreshed.
 *
 * Primary updates are event-driven, with a 10-second fallback poll for reliability.
 */

import { Agent, AgentStatus } from '../types';
import { getStatusService } from './StatusService';
import { getGitService } from './GitService';
import { getConfigService } from './ConfigService';
import { getEventBus } from './EventBus';
import { getLogger, isLoggerInitialized } from './Logger';

export interface AgentProvider {
    getAgents(): Agent[];
}

// Status file polling interval (1 second) - needs to be fast to detect Claude waiting for input
const STATUS_POLLING_INTERVAL_MS = 1000;

/**
 * StatusWatcher implementation
 */
export class StatusWatcher {
    private statusInterval: NodeJS.Timeout | null = null;
    private diffInterval: NodeJS.Timeout | null = null;
    private agentProvider: AgentProvider | null = null;

    private debugLog(message: string): void {
        if (isLoggerInitialized()) {
            getLogger().child('StatusWatcher').debug(message);
        }
    }

    /**
     * Start watching agent status
     */
    start(agentProvider: AgentProvider): void {
        this.agentProvider = agentProvider;

        const config = getConfigService();
        const diffPollingInterval = config.diffPollingInterval;

        this.debugLog(`Starting status watcher: status=${STATUS_POLLING_INTERVAL_MS}ms, diff=${diffPollingInterval}ms`);

        // Start status polling (fixed 10 second interval as fallback)
        this.statusInterval = setInterval(() => {
            this.checkAllAgentStatus();
        }, STATUS_POLLING_INTERVAL_MS);

        // Start diff polling if enabled
        if (diffPollingInterval > 0) {
            // Initial diff refresh
            this.refreshAllDiffStats();

            this.diffInterval = setInterval(() => {
                this.refreshAllDiffStats();
            }, diffPollingInterval);
        }

        // Emit initial refresh event
        getEventBus().emit('status:refreshed', {});
    }

    /**
     * Stop watching
     */
    stop(): void {
        if (this.statusInterval) {
            clearInterval(this.statusInterval);
            this.statusInterval = null;
        }
        if (this.diffInterval) {
            clearInterval(this.diffInterval);
            this.diffInterval = null;
        }
        this.agentProvider = null;
    }

    /**
     * Check status for all agents
     */
    private checkAllAgentStatus(): void {
        if (!this.agentProvider) {
            return;
        }

        const agents = this.agentProvider.getAgents();

        for (const agent of agents) {
            this.checkAgentStatus(agent);
        }

        // Always emit a refresh event so UI can update (e.g., for time displays)
        getEventBus().emit('status:refreshed', {});
    }

    /**
     * Check status for a single agent
     */
    private checkAgentStatus(agent: Agent): boolean {
        const parsedStatus = getStatusService().checkStatus(agent.worktreePath);
        if (!parsedStatus) {
            return false;
        }

        // Skip update if the status file is older than the agent's last interaction.
        // This prevents stale status files from overwriting manually-set status
        // (e.g., when user clicks "Allow" in UI but Claude hasn't written a new file yet).
        if (parsedStatus.fileTimestamp !== undefined) {
            const lastInteractionMs = agent.lastInteractionTime.getTime();
            if (parsedStatus.fileTimestamp < lastInteractionMs) {
                this.debugLog(`Skipping stale status file for agent ${agent.name} (file: ${parsedStatus.fileTimestamp}, interaction: ${lastInteractionMs})`);
                return false;
            }
        }

        const previousStatus = agent.status;
        const hadApproval = agent.pendingApproval !== null;

        agent.status = parsedStatus.status;
        agent.pendingApproval = parsedStatus.pendingApproval;

        // Update icon based on status
        this.updateAgentIcon(agent);

        // Emit status change event if status actually changed
        if (previousStatus !== agent.status) {
            getEventBus().emit('agent:statusChanged', { agent, previousStatus });
            return true;
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
            return true;
        }

        return false;
    }

    /**
     * Update agent status icon
     */
    private updateAgentIcon(agent: Agent): void {
        const STATUS_ICONS: Record<AgentStatus, string> = {
            'idle': 'circle-outline',
            'working': 'sync~spin',
            'waiting-input': 'question',
            'waiting-approval': 'alert',
            'stopped': 'circle-slash',
            'error': 'error',
        };

        if (agent.status === 'idle') {
            agent.statusIcon = agent.terminal ? 'circle-filled' : 'circle-outline';
        } else {
            agent.statusIcon = STATUS_ICONS[agent.status];
        }
    }

    /**
     * Refresh diff stats for all agents
     */
    private async refreshAllDiffStats(): Promise<void> {
        if (!this.agentProvider) {
            return;
        }

        const agents = this.agentProvider.getAgents();
        const promises: Promise<void>[] = [];

        for (const agent of agents) {
            promises.push(this.refreshAgentDiffStats(agent));
        }

        await Promise.all(promises);

        // Emit diff stats refreshed event
        getEventBus().emit('diffStats:refreshed', {});
    }

    /**
     * Refresh diff stats for a single agent
     */
    private async refreshAgentDiffStats(agent: Agent): Promise<void> {
        try {
            const gitService = getGitService();
            const baseBranch = await gitService.getBaseBranch(agent.repoPath);
            agent.diffStats = await gitService.getDiffStats(agent.worktreePath, baseBranch);
        } catch {
            // Keep existing stats on error
        }
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.stop();
    }
}

/**
 * Singleton instance
 */
let statusWatcherInstance: StatusWatcher | null = null;

/**
 * Get the global StatusWatcher instance
 */
export function getStatusWatcher(): StatusWatcher {
    if (!statusWatcherInstance) {
        statusWatcherInstance = new StatusWatcher();
    }
    return statusWatcherInstance;
}

/**
 * Reset the global StatusWatcher instance (for testing)
 */
export function resetStatusWatcher(): void {
    if (statusWatcherInstance) {
        statusWatcherInstance.dispose();
    }
    statusWatcherInstance = null;
}
