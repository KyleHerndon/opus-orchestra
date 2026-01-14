/**
 * StatusWatcher - Centralized status polling that emits events
 *
 * Polls agent status files and emits EventBus events when changes are detected.
 * This allows UI components to subscribe to events instead of being manually refreshed.
 *
 * User Input Detection:
 * - UI button clicks: Detected directly via sendToAgent(), updates lastInteractionTime
 * - Terminal input: Should be detected via Claude Code hooks (UserPromptSubmit),
 *   which update status files. The hooks are the authoritative source for user input.
 *
 * NOTE: TmuxControlWatcher is used to detect terminal output, but this includes BOTH
 * user input AND Claude's responses. It cannot reliably distinguish user actions.
 * For accurate user input detection, rely on:
 * - Claude Code hooks (UserPromptSubmit, PermissionRequest, etc.)
 * - Reading the conversation log
 */

import { Agent, AgentStatus } from '../types';
import { getStatusService } from './StatusService';
import { getGitService } from './GitService';
import { getConfigService } from './ConfigService';
import { getEventBus } from './EventBus';
import { getLogger, isLoggerInitialized } from './Logger';
import { TmuxControlWatcherManager, TmuxOutputEvent } from '@opus-orchestra/core';
import { getContainer, isContainerInitialized } from '../ServiceContainer';

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

    // Tmux control mode watcher for detecting approval resolution
    private tmuxWatcherManager: TmuxControlWatcherManager | null = null;
    // Map of tmux session name -> agent ID for lookup when output is received
    private sessionToAgentId: Map<string, number> = new Map();
    // Set of agent IDs that have pending approvals being watched
    private watchedApprovals: Set<number> = new Set();

    private debugLog(message: string): void {
        if (isLoggerInitialized()) {
            getLogger().child({ component: 'StatusWatcher' }).debug(message);
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

        // Initialize tmux control watcher manager for approval detection
        if (isContainerInitialized()) {
            const container = getContainer();
            this.tmuxWatcherManager = new TmuxControlWatcherManager(container.system, container.logger);
        }

        // Start status polling (fixed 1 second interval)
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
        // Stop all tmux control watchers
        if (this.tmuxWatcherManager) {
            this.tmuxWatcherManager.stopAll();
            this.tmuxWatcherManager = null;
        }
        this.sessionToAgentId.clear();
        this.watchedApprovals.clear();
        this.agentProvider = null;
    }

    /**
     * Start watching an agent's tmux session for output (approval resolution detection).
     * Called when a pending approval is detected.
     */
    private startWatchingForApproval(agent: Agent): void {
        if (!this.tmuxWatcherManager || !isContainerInitialized()) {
            return;
        }

        // Check if tmux is enabled
        const config = getConfigService();
        if (!config.useTmux) {
            return;
        }

        // Already watching this agent
        if (this.watchedApprovals.has(agent.id)) {
            return;
        }

        // Get tmux session name for this agent
        const container = getContainer();
        const sessionName = container.tmuxService.getAgentSessionName(agent);

        // Check if session exists
        if (!container.tmuxService.sessionExists(sessionName)) {
            this.debugLog(`Cannot watch approval for agent ${agent.name}: tmux session ${sessionName} doesn't exist`);
            return;
        }

        this.debugLog(`Starting tmux watcher for approval detection: agent=${agent.name}, session=${sessionName}`);

        // Map session to agent for lookup when output is received
        this.sessionToAgentId.set(sessionName, agent.id);
        this.watchedApprovals.add(agent.id);

        // Start watching and handle output events
        const watcher = this.tmuxWatcherManager.startWatching(sessionName);

        watcher.on('output', (event: TmuxOutputEvent) => {
            this.handleTmuxOutput(event);
        });

        watcher.on('error', (error: Error) => {
            this.debugLog(`Tmux watcher error for ${sessionName}: ${error.message}`);
        });

        watcher.on('exit', (code: number | null) => {
            this.debugLog(`Tmux watcher exited for ${sessionName} with code ${code}`);
            // Clean up mappings
            const agentId = this.sessionToAgentId.get(sessionName);
            if (agentId !== undefined) {
                this.watchedApprovals.delete(agentId);
            }
            this.sessionToAgentId.delete(sessionName);
        });
    }

    /**
     * Stop watching an agent's tmux session (approval was resolved).
     */
    private stopWatchingForApproval(agent: Agent): void {
        if (!this.tmuxWatcherManager || !isContainerInitialized()) {
            return;
        }

        if (!this.watchedApprovals.has(agent.id)) {
            return;
        }

        const container = getContainer();
        const sessionName = container.tmuxService.getAgentSessionName(agent);

        this.debugLog(`Stopping tmux watcher for agent ${agent.name}`);

        this.tmuxWatcherManager.stopWatching(sessionName);
        this.sessionToAgentId.delete(sessionName);
        this.watchedApprovals.delete(agent.id);
    }

    /**
     * Handle tmux output event.
     *
     * NOTE: This detects ANY terminal output (both user input AND Claude responses).
     * It cannot reliably distinguish user-initiated actions from Claude output.
     * This is used as a heuristic to clear pending approvals, but the authoritative
     * source for user input is Claude Code hooks (UserPromptSubmit, etc.).
     *
     * When output is detected on a session with a pending approval, we assume
     * the user responded (since Claude was waiting for input). This assumption
     * may be incorrect if Claude outputs something before receiving user input.
     */
    private handleTmuxOutput(event: TmuxOutputEvent): void {
        const agentId = this.sessionToAgentId.get(event.sessionName);
        if (agentId === undefined) {
            return;
        }

        // Find the agent
        const agents = this.agentProvider?.getAgents() ?? [];
        const agent = agents.find(a => a.id === agentId);
        if (!agent) {
            return;
        }

        // Only clear if agent still has a pending approval
        if (agent.pendingApproval === null) {
            return;
        }

        this.debugLog(`Detected output for agent ${agent.name} with pending approval - clearing approval`);

        // Clear the pending approval and update lastInteractionTime
        // This prevents the next status poll from overwriting our changes with a stale status file
        agent.pendingApproval = null;
        agent.status = 'working';
        agent.lastInteractionTime = new Date();
        this.updateAgentIcon(agent);

        // Emit approval resolved event
        getEventBus().emit('approval:resolved', { agentId: agent.id });

        // Stop watching since approval is resolved
        this.stopWatchingForApproval(agent);

        // Emit refresh event for UI update
        getEventBus().emit('status:refreshed', {});
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

            // Start watching tmux session for output (approval resolution)
            this.startWatchingForApproval(agent);

            return true;
        }

        // If approval was cleared (by status file update), stop watching
        if (hadApproval && agent.pendingApproval === null) {
            this.stopWatchingForApproval(agent);
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
