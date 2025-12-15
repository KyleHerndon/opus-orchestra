import * as vscode from 'vscode';
import { AgentManager, Agent, IsolationTier } from './agentManager';
import { formatTimeSince } from './types';
import { getTodoService, TodoItem, getEventBus, getPersistenceService } from './services';

// ============================================================================
// Message Types
// ============================================================================

/**
 * Messages sent FROM the webview TO the extension (user actions)
 */
interface WebviewIncomingMessage {
    command: string;
    agentId?: number;
    key?: string;
    text?: string;
    repoIndex?: number;
    isolationTier?: string;
    count?: number;
    tier?: string;
    newName?: string;
    scale?: number;
    // For drag/drop reordering
    sourceAgentId?: number;
    targetAgentId?: number;
    repoPath?: string;
    dropPosition?: 'before' | 'after';
}

/**
 * Messages sent FROM the extension TO the webview (UI updates)
 *
 * Update Strategy (all incremental, no full re-renders):
 * - 'updateAgents': Update status/stats in place
 * - 'swapCards': Swap two card positions (drag/drop reorder)
 * - 'addCard': Insert new agent card into DOM
 * - 'removeCard': Remove agent card from DOM
 */
type WebviewOutgoingMessage =
    | { command: 'updateAgents'; agents: AgentStatusUpdate[]; stats: DashboardStats }
    | { command: 'swapCards'; sourceAgentId: number; targetAgentId: number }
    | { command: 'addCard'; agentId: number; repoPath: string; cardHtml: string }
    | { command: 'removeCard'; agentId: number };

/** Status data for incremental agent updates */
interface AgentStatusUpdate {
    id: number;
    status: string;
    statusClass: string;
    timeSince: string;
    insertions: number;
    deletions: number;
}

/** Aggregate stats for the dashboard header */
interface DashboardStats {
    total: number;
    working: number;
    waiting: number;
    containerized: number;
    insertions: number;
    deletions: number;
}

/** Active operation state for loading indicators */
interface ActiveOperation {
    operationId: string;
    type: string;
    message: string;
    current?: number;
    total?: number;
}

export class AgentPanel {
    public static currentPanel: AgentPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _agentManager: AgentManager;
    private _disposables: vscode.Disposable[] = [];
    private _availableTiers: IsolationTier[] = ['standard'];
    private _containerStats: Map<number, { memoryMB: number; cpuPercent: number }> = new Map();
    private _lastStatsUpdate: number = 0;
    private readonly _updateHandler = () => this._update();
    private readonly _operationStartedHandler = (payload: { operationId: string; type: string; message: string }) => this._handleOperationStarted(payload);
    private readonly _operationProgressHandler = (payload: { operationId: string; type: string; current: number; total: number; message: string }) => this._handleOperationProgress(payload);
    private readonly _operationCompletedHandler = () => this._handleOperationCompleted();
    private _activeOperation: ActiveOperation | null = null;
    private _lastAgentIds: Set<number> = new Set();

    private constructor(panel: vscode.WebviewPanel, agentManager: AgentManager) {
        this._panel = panel;
        this._agentManager = agentManager;

        // Fetch available tiers immediately
        this._fetchAvailableTiers();

        // Initial full render (only time we do full render)
        this._fullRender(this._agentManager.getAgents());

        // Subscribe to EventBus for reactive updates
        const eventBus = getEventBus();
        eventBus.on('agent:created', this._updateHandler);
        eventBus.on('agent:deleted', this._updateHandler);
        eventBus.on('agent:renamed', this._updateHandler);
        eventBus.on('agent:terminalClosed', this._updateHandler);
        eventBus.on('agent:statusChanged', this._updateHandler);
        eventBus.on('approval:pending', this._updateHandler);
        eventBus.on('approval:resolved', this._updateHandler);
        eventBus.on('status:refreshed', this._updateHandler);
        eventBus.on('diffStats:refreshed', this._updateHandler);

        // Subscribe to operation events for loading states
        eventBus.on('operation:started', this._operationStartedHandler);
        eventBus.on('operation:progress', this._operationProgressHandler);
        eventBus.on('operation:completed', this._operationCompletedHandler);
        eventBus.on('operation:failed', this._operationCompletedHandler);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            (message: WebviewIncomingMessage) => this._handleMessage(message),
            null,
            this._disposables
        );
    }

    // ========================================================================
    // Webview Communication
    // ========================================================================

    /**
     * Send a message to the webview for incremental UI updates.
     * Prefer this over full HTML re-renders when possible.
     */
    private _postMessage(message: WebviewOutgoingMessage): void {
        this._panel.webview.postMessage(message);
    }

    public static show(agentManager: AgentManager) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (AgentPanel.currentPanel) {
            AgentPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'agentDashboard',
            'Claude Agents Dashboard',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        AgentPanel.currentPanel = new AgentPanel(panel, agentManager);
    }

    /** Handle incoming messages from the webview (user actions) */
    private async _handleMessage(message: WebviewIncomingMessage): Promise<void> {
        const agentId = message.agentId !== undefined ? Number(message.agentId) : undefined;

        switch (message.command) {
            case 'sendKey':
                if (agentId !== undefined && message.key) {
                    this._agentManager.sendToAgent(agentId, message.key);
                    // Focus terminal for options 3/4 (reject) since they may need explanation
                    if (message.key === '3' || message.key === '4') {
                        this._agentManager.focusAgent(agentId);
                    }
                }
                break;
            case 'focus':
                if (agentId !== undefined) {
                    this._agentManager.focusAgent(agentId);
                }
                break;
            case 'sendMessage':
                if (agentId !== undefined && message.text) {
                    this._agentManager.sendToAgent(agentId, message.text);
                }
                break;
            case 'startClaude':
                if (agentId !== undefined) {
                    await this._agentManager.startClaudeInAgent(agentId);
                }
                break;
            case 'createAgents': {
                const repoPaths = this._agentManager.getRepositoryPaths();
                const repoIndex = message.repoIndex ?? 0;
                const selectedRepo = repoPaths[repoIndex] || repoPaths[0];
                const tier = (message.isolationTier as IsolationTier) || 'standard';
                const count = message.count ?? 1;
                await this._agentManager.createAgents(count, selectedRepo, tier);
                break;
            }
            case 'changeIsolation':
                if (agentId !== undefined && message.tier) {
                    await this._agentManager.changeAgentIsolationTier(agentId, message.tier as IsolationTier);
                }
                break;
            case 'deleteAgent':
                if (agentId !== undefined) {
                    const confirm = await vscode.window.showWarningMessage(
                        `Delete agent ${agentId} and its worktree?`,
                        { modal: true },
                        'Delete'
                    );
                    if (confirm === 'Delete') {
                        await this._agentManager.deleteAgent(agentId);
                    }
                }
                break;
            case 'addAgent': {
                const repos = this._agentManager.getRepositoryPaths();
                if (repos.length > 0) {
                    await this._agentManager.createAgents(1, repos[0]);
                }
                break;
            }
            case 'addAgentToRepo': {
                const repos = this._agentManager.getRepositoryPaths();
                const repoIndex = message.repoIndex as number ?? 0;
                const selectedRepo = repos[repoIndex] || repos[0];
                if (selectedRepo) {
                    await this._agentManager.createAgents(1, selectedRepo);
                }
                break;
            }
            case 'renameAgent':
                if (agentId !== undefined && message.newName) {
                    await this._agentManager.renameAgent(agentId, message.newName);
                }
                break;
            case 'viewDiff':
                if (agentId !== undefined) {
                    await this._agentManager.showAgentDiff(agentId);
                }
                break;
            case 'setScale':
                if (message.scale !== undefined) {
                    const config = vscode.workspace.getConfiguration('claudeAgents');
                    await config.update('uiScale', message.scale, vscode.ConfigurationTarget.Global);
                }
                break;
            case 'reorderAgents':
                if (message.sourceAgentId !== undefined &&
                    message.targetAgentId !== undefined &&
                    message.repoPath) {
                    await this._handleReorder(
                        message.sourceAgentId,
                        message.targetAgentId,
                        message.repoPath
                    );
                    // Send swap command to webview to reorder DOM elements
                    this._postMessage({
                        command: 'swapCards',
                        sourceAgentId: message.sourceAgentId,
                        targetAgentId: message.targetAgentId
                    });
                    return;
                }
                break;
        }
        this._update();
    }

    private async _fetchAvailableTiers(): Promise<void> {
        try {
            this._availableTiers = await this._agentManager.getAvailableIsolationTiers();
        } catch {
            this._availableTiers = ['standard'];
        }
    }

    private async _fetchContainerStats(agents: Agent[]): Promise<void> {
        // Only update stats every 5 seconds to avoid performance issues
        const now = Date.now();
        if (now - this._lastStatsUpdate < 5000) {
            return;
        }
        this._lastStatsUpdate = now;

        // Fetch stats for all containerized agents
        for (const agent of agents) {
            if (agent.isolationTier && agent.isolationTier !== 'standard') {
                try {
                    const stats = await this._agentManager.getAgentContainerStats(agent.id);
                    if (stats) {
                        this._containerStats.set(agent.id, stats);
                    }
                } catch {
                    // Ignore errors
                }
            }
        }
    }

    private _handleOperationStarted(payload: { operationId: string; type: string; message: string }): void {
        this._activeOperation = {
            operationId: payload.operationId,
            type: payload.type,
            message: payload.message,
        };
        this._update();
    }

    private _handleOperationProgress(payload: { operationId: string; type: string; current: number; total: number; message: string }): void {
        if (this._activeOperation && this._activeOperation.operationId === payload.operationId) {
            this._activeOperation.current = payload.current;
            this._activeOperation.total = payload.total;
            this._activeOperation.message = payload.message;
            this._update();
        }
    }

    private _handleOperationCompleted(): void {
        this._activeOperation = null;
        this._update();
    }

    private async _handleReorder(
        sourceAgentId: number,
        targetAgentId: number,
        repoPath: string
    ): Promise<void> {
        const persistenceService = getPersistenceService();
        const agents = this._agentManager.getAgents()
            .filter(a => a.repoPath === repoPath);

        if (agents.length < 2) {
            return; // Nothing to reorder
        }

        // Get current order map
        const orderMap = persistenceService.getAgentOrder(repoPath);

        // Ensure ALL agents have an order entry (fill in missing ones)
        const sortedAgents = [...agents].sort((a, b) => a.id - b.id);
        let maxOrder = -1;
        for (const id in orderMap) {
            if (orderMap[id] > maxOrder) {
                maxOrder = orderMap[id];
            }
        }
        for (const agent of sortedAgents) {
            if (orderMap[agent.id] === undefined) {
                maxOrder++;
                orderMap[agent.id] = maxOrder;
            }
        }

        // Swap the order values of source and target
        const sourceOrder = orderMap[sourceAgentId];
        const targetOrder = orderMap[targetAgentId];
        orderMap[sourceAgentId] = targetOrder;
        orderMap[targetAgentId] = sourceOrder;

        persistenceService.saveAgentOrder(repoPath, orderMap);
    }

    // ========================================================================
    // UI Update Methods
    // ========================================================================

    /**
     * Main update entry point. Always uses incremental updates to avoid
     * interrupting user interactions.
     *
     * Update strategy:
     * - Agent added: Insert card via addCard message
     * - Agent removed: Remove card via removeCard message
     * - Status/stats change: Update in place via updateAgents message
     * - Order change: Handled separately via swapCards message
     */
    private _update(): void {
        const agents = this._agentManager.getAgents();
        const currentIds = new Set(agents.map(a => a.id));

        // Find added and removed agents
        const addedIds = [...currentIds].filter(id => !this._lastAgentIds.has(id));
        const removedIds = [...this._lastAgentIds].filter(id => !currentIds.has(id));

        // Handle removals first
        for (const id of removedIds) {
            this._postMessage({ command: 'removeCard', agentId: id });
        }

        // Handle additions
        for (const id of addedIds) {
            const agent = agents.find(a => a.id === id);
            if (agent) {
                this._postMessage({
                    command: 'addCard',
                    agentId: id,
                    repoPath: agent.repoPath,
                    cardHtml: this._getAgentCard(agent)
                });
            }
        }

        // Update tracked IDs
        this._lastAgentIds = currentIds;

        // Always send status/stats update
        this._sendIncrementalUpdate(agents);

        // Fetch container stats for new agents
        if (addedIds.length > 0) {
            this._fetchContainerStats(agents);
        }
    }

    /**
     * Full HTML re-render. Only used for initial render when panel opens.
     */
    private _fullRender(agents: Agent[]): void {
        this._lastAgentIds = new Set(agents.map(a => a.id));
        this._fetchContainerStats(agents);
        this._panel.webview.html = this._getHtml(agents);
    }

    /**
     * Incremental update via postMessage. Updates status/stats in place without
     * regenerating HTML. Much faster than full re-render.
     */
    private _sendIncrementalUpdate(agents: Agent[]): void {
        const agentData = agents.map(agent => {
            const isWaiting = agent.status === 'waiting-input' || agent.status === 'waiting-approval';
            const statusClass = agent.status === 'working' ? 'status-working'
                : isWaiting ? 'status-waiting'
                : agent.status === 'stopped' ? 'status-stopped'
                : agent.status === 'error' ? 'status-error'
                : 'status-idle';

            return {
                id: agent.id,
                status: agent.status,
                statusClass,
                timeSince: formatTimeSince(agent.lastInteractionTime, true),
                insertions: agent.diffStats.insertions,
                deletions: agent.diffStats.deletions,
            };
        });

        const totalInsertions = agents.reduce((sum, a) => sum + a.diffStats.insertions, 0);
        const totalDeletions = agents.reduce((sum, a) => sum + a.diffStats.deletions, 0);
        const waitingCount = agents.filter(a =>
            a.status === 'waiting-input' || a.status === 'waiting-approval'
        ).length;
        const workingCount = agents.filter(a => a.status === 'working').length;
        const containerizedCount = agents.filter(a => a.isolationTier && a.isolationTier !== 'standard').length;

        this._postMessage({
            command: 'updateAgents',
            agents: agentData,
            stats: {
                total: agents.length,
                working: workingCount,
                waiting: waitingCount,
                containerized: containerizedCount,
                insertions: totalInsertions,
                deletions: totalDeletions,
            }
        });
    }

    private _getHtml(agents: Agent[]): string {
        const hasAgents = agents.length > 0;

        const config = vscode.workspace.getConfiguration('claudeAgents');
        const uiScale = config.get<number>('uiScale', 1.0);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude Agents Dashboard</title>
    <style>
        :root {
            --ui-scale: ${uiScale};
        }
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: calc(20px * var(--ui-scale));
            min-height: 100vh;
            font-size: calc(14px * var(--ui-scale));
        }
        .stats-title {
            font-size: calc(20px * var(--ui-scale));
            font-weight: 600;
            margin-right: auto;
        }
        .btn {
            padding: calc(8px * var(--ui-scale)) calc(16px * var(--ui-scale));
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: calc(13px * var(--ui-scale));
            font-family: inherit;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-danger {
            background: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-inputValidation-errorForeground);
        }
        .btn-small {
            padding: calc(4px * var(--ui-scale)) calc(8px * var(--ui-scale));
            font-size: calc(12px * var(--ui-scale));
        }
        .stats-bar {
            display: flex;
            gap: calc(24px * var(--ui-scale));
            margin-bottom: calc(24px * var(--ui-scale));
            padding: calc(16px * var(--ui-scale));
            background: var(--vscode-sideBar-background);
            border-radius: 8px;
        }
        .stat {
            text-align: center;
        }
        .stat-value {
            font-size: calc(32px * var(--ui-scale));
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        .stat-label {
            font-size: calc(12px * var(--ui-scale));
            color: var(--vscode-descriptionForeground);
            margin-top: calc(4px * var(--ui-scale));
        }
        .repo-section {
            margin-bottom: calc(32px * var(--ui-scale));
        }
        .repo-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: calc(16px * var(--ui-scale));
            padding-bottom: calc(8px * var(--ui-scale));
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        .repo-title {
            font-size: calc(18px * var(--ui-scale));
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: calc(8px * var(--ui-scale));
        }
        .repo-path {
            font-size: calc(12px * var(--ui-scale));
            color: var(--vscode-descriptionForeground);
            font-weight: normal;
        }
        .repo-actions {
            display: flex;
            gap: calc(8px * var(--ui-scale));
        }
        .agents-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(calc(350px * var(--ui-scale)), 1fr));
            gap: calc(16px * var(--ui-scale));
        }
        .agent-card {
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px;
            padding: calc(16px * var(--ui-scale));
        }
        .agent-card.waiting {
            border-color: var(--vscode-inputValidation-warningBorder);
            box-shadow: 0 0 0 1px var(--vscode-inputValidation-warningBorder);
        }
        .agent-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: calc(12px * var(--ui-scale));
        }
        .agent-title {
            font-size: calc(16px * var(--ui-scale));
            font-weight: 600;
        }
        .agent-title-input {
            font-size: calc(18px * var(--ui-scale));
            font-weight: 600;
            background: transparent;
            border: 1px solid transparent;
            border-radius: 4px;
            padding: calc(2px * var(--ui-scale)) calc(6px * var(--ui-scale));
            margin: calc(-2px * var(--ui-scale)) calc(-6px * var(--ui-scale));
            color: inherit;
            font-family: inherit;
            width: auto;
            min-width: calc(60px * var(--ui-scale));
            max-width: calc(200px * var(--ui-scale));
        }
        .agent-title-input:hover {
            border-color: var(--vscode-input-border);
        }
        .agent-title-input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
            background: var(--vscode-input-background);
        }
        .agent-status {
            padding: calc(4px * var(--ui-scale)) calc(8px * var(--ui-scale));
            border-radius: calc(12px * var(--ui-scale));
            font-size: calc(11px * var(--ui-scale));
            font-weight: 500;
            text-transform: uppercase;
        }
        .status-working {
            background: var(--vscode-testing-runAction);
            color: white;
        }
        .status-waiting {
            background: var(--vscode-inputValidation-warningBackground);
            color: var(--vscode-inputValidation-warningForeground);
        }
        .status-idle {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }
        .status-stopped {
            background: var(--vscode-debugIcon-stopForeground, #f44);
            color: white;
        }
        .status-error {
            background: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-inputValidation-errorForeground);
        }
        /* Isolation tier badges */
        .isolation-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: calc(2px * var(--ui-scale)) calc(6px * var(--ui-scale));
            border-radius: calc(4px * var(--ui-scale));
            font-size: calc(10px * var(--ui-scale));
            font-weight: 500;
            text-transform: uppercase;
        }
        .isolation-standard {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }
        .isolation-sandbox {
            background: rgba(100, 149, 237, 0.2);
            color: cornflowerblue;
            border: 1px solid cornflowerblue;
        }
        .isolation-docker {
            background: rgba(0, 149, 237, 0.2);
            color: #2196F3;
            border: 1px solid #2196F3;
        }
        .isolation-gvisor {
            background: rgba(156, 39, 176, 0.2);
            color: #9C27B0;
            border: 1px solid #9C27B0;
        }
        .isolation-firecracker {
            background: rgba(76, 175, 80, 0.2);
            color: #4CAF50;
            border: 1px solid #4CAF50;
        }
        /* Containerized agent card styling */
        .agent-card.containerized {
            border-left: 3px solid #2196F3;
        }
        .agent-card.containerized.tier-sandbox {
            border-left-color: cornflowerblue;
        }
        .agent-card.containerized.tier-gvisor {
            border-left-color: #9C27B0;
        }
        .agent-card.containerized.tier-firecracker {
            border-left-color: #4CAF50;
        }
        /* Tier select dropdown styling */
        .tier-select {
            padding: 8px;
            border-radius: 4px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-size: calc(12px * var(--ui-scale));
        }
        .tier-select-small {
            padding: 4px 8px;
            font-size: calc(11px * var(--ui-scale));
            min-width: 100px;
        }
        /* Container stats display */
        .container-stats {
            display: flex;
            gap: calc(12px * var(--ui-scale));
            padding: calc(8px * var(--ui-scale));
            margin-bottom: calc(8px * var(--ui-scale));
            background: var(--vscode-editor-background);
            border-radius: 4px;
            font-size: calc(11px * var(--ui-scale));
        }
        .container-stat {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .container-stat-label {
            color: var(--vscode-descriptionForeground);
        }
        .container-stat-value {
            font-weight: 500;
        }
        .container-state {
            padding: 2px 6px;
            border-radius: 3px;
            font-size: calc(10px * var(--ui-scale));
            text-transform: uppercase;
        }
        .container-state.running {
            background: rgba(76, 175, 80, 0.2);
            color: #4CAF50;
        }
        .container-state.stopped {
            background: rgba(244, 67, 54, 0.2);
            color: #f44336;
        }
        .container-state.error {
            background: rgba(244, 67, 54, 0.3);
            color: #f44336;
        }
        .approval-label {
            font-size: calc(12px * var(--ui-scale));
            color: var(--vscode-inputValidation-warningForeground);
            font-weight: 500;
        }
        .approval-context {
            font-size: calc(11px * var(--ui-scale));
            color: var(--vscode-descriptionForeground);
            background: var(--vscode-inputValidation-warningBackground);
            padding: calc(4px * var(--ui-scale)) calc(8px * var(--ui-scale));
            border-radius: 4px;
            margin-top: calc(8px * var(--ui-scale));
            word-break: break-all;
        }
        .approval-actions {
            display: flex;
            gap: calc(8px * var(--ui-scale));
            margin-top: calc(8px * var(--ui-scale));
        }
        .agent-stats {
            display: flex;
            gap: calc(16px * var(--ui-scale));
            margin-bottom: calc(12px * var(--ui-scale));
            font-size: calc(14px * var(--ui-scale));
        }
        .stat-item {
            display: flex;
            flex-direction: column;
            gap: calc(2px * var(--ui-scale));
        }
        .stat-label {
            font-size: calc(11px * var(--ui-scale));
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
        }
        .stat-value {
            font-size: calc(13px * var(--ui-scale));
            font-weight: 500;
        }
        .agent-info {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 12px;
            font-size: 13px;
        }
        .info-item {
            display: flex;
            flex-direction: column;
        }
        .info-label {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
        }
        .info-value {
            font-weight: 500;
        }
        .diff-stats {
            display: flex;
            gap: 12px;
            align-items: center;
        }
        .diff-add {
            color: var(--vscode-gitDecoration-addedResourceForeground);
        }
        .diff-del {
            color: var(--vscode-gitDecoration-deletedResourceForeground);
        }
        .btn-icon {
            background: none;
            border: none;
            cursor: pointer;
            padding: 2px 4px;
            font-size: 14px;
            opacity: 0.7;
            transition: opacity 0.2s;
        }
        .btn-icon:hover {
            opacity: 1;
        }
        .btn-muted {
            opacity: 0.7;
        }
        .btn-muted:hover {
            opacity: 1;
        }
        .agent-actions {
            display: flex;
            gap: 8px;
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid var(--vscode-widget-border);
        }
        .empty-state {
            text-align: center;
            padding: 60px 20px;
        }
        .empty-state h2 {
            margin-bottom: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .empty-state p {
            margin-bottom: 24px;
            color: var(--vscode-descriptionForeground);
        }
        .create-form {
            display: flex;
            gap: 8px;
            justify-content: center;
            align-items: center;
        }
        .create-form input {
            width: 60px;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            text-align: center;
        }
        /* TODO Section Styles */
        .todo-section {
            margin-top: calc(12px * var(--ui-scale));
            padding: calc(10px * var(--ui-scale));
            background: var(--vscode-editor-background);
            border-radius: 6px;
            border: 1px solid var(--vscode-widget-border);
        }
        .todo-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: calc(8px * var(--ui-scale));
        }
        .todo-title {
            font-size: calc(11px * var(--ui-scale));
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .todo-meta {
            font-size: calc(10px * var(--ui-scale));
            color: var(--vscode-descriptionForeground);
        }
        .todo-list {
            list-style: none;
            margin: 0;
            padding: 0;
        }
        .todo-item {
            display: flex;
            align-items: flex-start;
            gap: calc(8px * var(--ui-scale));
            padding: calc(6px * var(--ui-scale)) 0;
            font-size: calc(13px * var(--ui-scale));
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        .todo-item:last-child {
            border-bottom: none;
        }
        .todo-icon {
            flex-shrink: 0;
            width: calc(18px * var(--ui-scale));
            height: calc(18px * var(--ui-scale));
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: calc(12px * var(--ui-scale));
        }
        .todo-icon.pending {
            color: var(--vscode-descriptionForeground);
        }
        .todo-icon.in_progress {
            color: var(--vscode-testing-runAction);
        }
        .todo-icon.completed {
            color: var(--vscode-gitDecoration-addedResourceForeground);
        }
        .todo-content {
            flex: 1;
        }
        .todo-content.completed {
            text-decoration: line-through;
            opacity: 0.6;
        }
        .todo-content.in_progress {
            color: var(--vscode-gitDecoration-addedResourceForeground);
            font-style: italic;
        }
        /* Loading indicator styles */
        .loading-overlay {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-textLink-foreground);
            border-radius: 8px;
            padding: calc(16px * var(--ui-scale));
            margin-bottom: calc(24px * var(--ui-scale));
            display: flex;
            align-items: center;
            gap: calc(12px * var(--ui-scale));
        }
        .loading-spinner {
            width: calc(24px * var(--ui-scale));
            height: calc(24px * var(--ui-scale));
            border: 3px solid var(--vscode-widget-border);
            border-top-color: var(--vscode-textLink-foreground);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .loading-content {
            flex: 1;
        }
        .loading-message {
            font-weight: 500;
            margin-bottom: calc(4px * var(--ui-scale));
        }
        .loading-progress {
            display: flex;
            align-items: center;
            gap: calc(8px * var(--ui-scale));
        }
        .loading-bar {
            flex: 1;
            height: calc(6px * var(--ui-scale));
            background: var(--vscode-widget-border);
            border-radius: calc(3px * var(--ui-scale));
            overflow: hidden;
        }
        .loading-bar-fill {
            height: 100%;
            background: var(--vscode-textLink-foreground);
            transition: width 0.3s ease;
        }
        .loading-percent {
            font-size: calc(12px * var(--ui-scale));
            color: var(--vscode-descriptionForeground);
            min-width: calc(40px * var(--ui-scale));
            text-align: right;
        }
        /* Drag and drop styles */
        .agent-card[draggable="true"] {
            cursor: grab;
            transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
        }
        .agent-card[draggable="true"]:active {
            cursor: grabbing;
        }
        .agent-card.dragging {
            opacity: 0.5;
            transform: scale(1.02);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }
        .agent-card.drag-over-left {
            border-left: 3px solid var(--vscode-textLink-foreground);
        }
        .agent-card.drag-over-right {
            border-right: 3px solid var(--vscode-textLink-foreground);
        }
    </style>
</head>
<body>
    ${this._getLoadingIndicator()}

    ${hasAgents ? this._getAgentsDashboard(agents) : this._getEmptyState()}

    <script>
        // Use IIFE to ensure we only initialize once
        (function() {
            // Prevent multiple initializations when HTML is regenerated
            if (window._webviewInitialized) {
                return;
            }
            window._webviewInitialized = true;

            // Acquire VS Code API once
            const vscode = acquireVsCodeApi();

            // Listen for incremental updates from extension
            window.addEventListener('message', function(event) {
                const message = event.data;
                if (message.command === 'swapCards') {
                    // Swap two cards in the DOM
                    const sourceCard = document.querySelector('.agent-card[data-agent-id="' + message.sourceAgentId + '"]');
                    const targetCard = document.querySelector('.agent-card[data-agent-id="' + message.targetAgentId + '"]');
                    if (sourceCard && targetCard && sourceCard.parentNode === targetCard.parentNode) {
                        const parent = sourceCard.parentNode;
                        const sourceNext = sourceCard.nextSibling;
                        const targetNext = targetCard.nextSibling;

                        // Swap positions
                        if (sourceNext === targetCard) {
                            parent.insertBefore(targetCard, sourceCard);
                        } else if (targetNext === sourceCard) {
                            parent.insertBefore(sourceCard, targetCard);
                        } else {
                            parent.insertBefore(sourceCard, targetNext);
                            parent.insertBefore(targetCard, sourceNext);
                        }
                    }
                    return;
                }
                if (message.command === 'addCard') {
                    // Find the grid for this repo
                    const grids = document.querySelectorAll('.agents-grid');
                    for (const grid of grids) {
                        const repoSection = grid.closest('.repo-section');
                        if (repoSection) {
                            const repoPath = repoSection.querySelector('.repo-path');
                            if (repoPath && repoPath.textContent === message.repoPath) {
                                // Remove "no agents" placeholder if present
                                const placeholder = grid.querySelector('div[style*="color: var(--vscode-descriptionForeground)"]');
                                if (placeholder) {
                                    placeholder.remove();
                                }
                                // Insert new card at the end
                                grid.insertAdjacentHTML('beforeend', message.cardHtml);
                                return;
                            }
                        }
                    }
                    return;
                }
                if (message.command === 'removeCard') {
                    const card = document.querySelector('.agent-card[data-agent-id="' + message.agentId + '"]');
                    if (card) {
                        card.remove();
                    }
                    return;
                }
                if (message.command === 'updateAgents') {
                    // Update each agent's status and stats in place
                    for (const agent of message.agents) {
                        const card = document.querySelector('.agent-card[data-agent-id="' + agent.id + '"]');
                        if (!card) continue;

                        // Update status
                        const statusEl = card.querySelector('.agent-status');
                        if (statusEl) {
                            statusEl.textContent = agent.status;
                            statusEl.className = 'agent-status ' + agent.statusClass;
                        }

                        // Update time since
                        const timeEl = card.querySelector('.stat-value');
                        if (timeEl) {
                            timeEl.textContent = agent.timeSince;
                        }

                        // Update working/waiting label
                        const labelEl = card.querySelector('.stat-label');
                        if (labelEl) {
                            labelEl.textContent = agent.status === 'working' ? 'Working' : 'Waiting';
                        }

                        // Update diff stats
                        const diffAdd = card.querySelector('.diff-add');
                        const diffDel = card.querySelector('.diff-del');
                        if (diffAdd) diffAdd.textContent = '+' + agent.insertions;
                        if (diffDel) diffDel.textContent = '-' + agent.deletions;

                        // Update waiting class on card
                        const isWaiting = agent.status === 'waiting-input' || agent.status === 'waiting-approval';
                        card.classList.toggle('waiting', isWaiting);
                    }

                    // Update stats bar
                    if (message.stats) {
                        const statValues = document.querySelectorAll('.stats-bar .stat-value');
                        if (statValues.length >= 5) {
                            statValues[0].textContent = message.stats.total;
                            statValues[1].textContent = message.stats.working;
                            statValues[2].textContent = message.stats.waiting;
                            statValues[3].textContent = message.stats.containerized;
                        }
                        const diffStats = document.querySelector('.stats-bar .diff-stats');
                        if (diffStats) {
                            const add = diffStats.querySelector('.diff-add');
                            const del = diffStats.querySelector('.diff-del');
                            if (add) add.textContent = '+' + message.stats.insertions;
                            if (del) del.textContent = '-' + message.stats.deletions;
                        }
                    }
                }
            });

            // Use event delegation for all button clicks
            document.addEventListener('click', function(e) {
                const button = e.target.closest('button[data-action]');
                if (!button) return;

                const action = button.getAttribute('data-action');
                const agentId = button.getAttribute('data-agent-id');
                const agentIdNum = agentId ? parseInt(agentId, 10) : undefined;

                switch (action) {
                    case 'focus':
                        vscode.postMessage({ command: 'focus', agentId: agentIdNum });
                        break;
                    case 'startClaude':
                        vscode.postMessage({ command: 'startClaude', agentId: agentIdNum });
                        break;
                    case 'sendKey':
                        const key = e.target.getAttribute('data-key');
                        vscode.postMessage({ command: 'sendKey', agentId: agentIdNum, key: key });
                        break;
                    case 'deleteAgent':
                        // Send directly - confirmation handled by extension
                        vscode.postMessage({ command: 'deleteAgent', agentId: agentIdNum });
                        break;
                    case 'viewDiff':
                        vscode.postMessage({ command: 'viewDiff', agentId: agentIdNum });
                        break;
                    case 'createAgents':
                        const count = parseInt(document.getElementById('agent-count').value) || 3;
                        const repoSelect = document.getElementById('repo-select');
                        const repoIndex = repoSelect ? parseInt(repoSelect.value) : 0;
                        const tierSelect = document.getElementById('isolation-tier-select');
                        const isolationTier = tierSelect ? tierSelect.value : 'standard';
                        vscode.postMessage({ command: 'createAgents', count: count, repoIndex: repoIndex, isolationTier: isolationTier });
                        break;
                    case 'addAgent':
                        vscode.postMessage({ command: 'addAgent' });
                        break;
                    case 'addAgentToRepo':
                        const repoIdx = parseInt(button.getAttribute('data-repo-index')) || 0;
                        vscode.postMessage({ command: 'addAgentToRepo', repoIndex: repoIdx });
                        break;
                }
            });

            // Handle isolation tier dropdown change
            document.addEventListener('change', function(e) {
                const select = e.target.closest('select[data-action="changeIsolation"]');
                if (!select) return;

                const agentId = select.getAttribute('data-agent-id');
                const agentIdNum = agentId ? parseInt(agentId, 10) : undefined;
                const newTier = select.value;

                vscode.postMessage({ command: 'changeIsolation', agentId: agentIdNum, tier: newTier });
            });

            // Handle inline rename on Enter or blur
            function handleRename(input) {
                const newName = input.value.trim();
                const original = input.getAttribute('data-original');
                const agentId = parseInt(input.getAttribute('data-agent-id'), 10);

                if (newName && newName !== original) {
                    vscode.postMessage({ command: 'renameAgent', agentId: agentId, newName: newName });
                } else {
                    // Revert to original
                    input.value = original;
                }
            }

            document.addEventListener('keydown', function(e) {
                if (e.target.classList.contains('agent-title-input')) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        e.target.blur();
                    } else if (e.key === 'Escape') {
                        e.target.value = e.target.getAttribute('data-original');
                        e.target.blur();
                    }
                }
            });

            document.addEventListener('blur', function(e) {
                if (e.target.classList.contains('agent-title-input')) {
                    handleRename(e.target);
                }
            }, true);

            // Drag and drop for agent reordering
            let draggedAgentId = null;
            let draggedRepoPath = null;

            document.addEventListener('dragstart', function(e) {
                // Don't allow drag from interactive elements
                const interactive = e.target.closest('button, input, select, a, .btn, .btn-icon');
                if (interactive) {
                    e.preventDefault();
                    return;
                }

                const card = e.target.closest('.agent-card');
                if (!card) return;

                draggedAgentId = parseInt(card.getAttribute('data-agent-id'), 10);
                draggedRepoPath = card.getAttribute('data-repo-path');

                card.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(draggedAgentId));
            });

            document.addEventListener('dragend', function(e) {
                // Clean up ALL dragging classes on all cards
                document.querySelectorAll('.agent-card.dragging').forEach(function(el) {
                    el.classList.remove('dragging');
                });
                // Clean up all drag-over classes
                document.querySelectorAll('.drag-over-left, .drag-over-right').forEach(function(el) {
                    el.classList.remove('drag-over-left', 'drag-over-right');
                });
                draggedAgentId = null;
                draggedRepoPath = null;
            });

            document.addEventListener('dragover', function(e) {
                const card = e.target.closest('.agent-card');
                if (!card) return;

                const targetRepoPath = card.getAttribute('data-repo-path');
                // Only allow reordering within same repo
                if (targetRepoPath !== draggedRepoPath) return;

                const targetAgentId = parseInt(card.getAttribute('data-agent-id'), 10);
                // Don't show indicator on self
                if (targetAgentId === draggedAgentId) return;

                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';

                // Remove previous indicators
                document.querySelectorAll('.drag-over-left, .drag-over-right').forEach(function(el) {
                    el.classList.remove('drag-over-left', 'drag-over-right');
                });

                // Show drop indicator based on cursor position (horizontal for grid)
                const rect = card.getBoundingClientRect();
                const midpoint = rect.left + rect.width / 2;
                if (e.clientX < midpoint) {
                    card.classList.add('drag-over-left');
                } else {
                    card.classList.add('drag-over-right');
                }
            });

            document.addEventListener('dragleave', function(e) {
                const card = e.target.closest('.agent-card');
                if (card && !card.contains(e.relatedTarget)) {
                    card.classList.remove('drag-over-left', 'drag-over-right');
                }
            });

            document.addEventListener('drop', function(e) {
                e.preventDefault();

                const card = e.target.closest('.agent-card');
                if (!card) return;

                const targetAgentId = parseInt(card.getAttribute('data-agent-id'), 10);
                const targetRepoPath = card.getAttribute('data-repo-path');

                // Only reorder within same repo
                if (targetRepoPath !== draggedRepoPath) return;

                // Don't do anything if dropped on self
                if (targetAgentId === draggedAgentId) return;

                // Determine if dropping before or after target (use X for grid layout)
                const rect = card.getBoundingClientRect();
                const dropPosition = e.clientX < (rect.left + rect.width / 2) ? 'before' : 'after';

                vscode.postMessage({
                    command: 'reorderAgents',
                    sourceAgentId: draggedAgentId,
                    targetAgentId: targetAgentId,
                    repoPath: targetRepoPath,
                    dropPosition: dropPosition
                });

                // Clean up
                document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(function(el) {
                    el.classList.remove('drag-over-top', 'drag-over-bottom');
                });
            });
        })();
    </script>
</body>
</html>`;
    }

    private _getAgentsDashboard(agents: Agent[]): string {
        const totalInsertions = agents.reduce((sum, a) => sum + a.diffStats.insertions, 0);
        const totalDeletions = agents.reduce((sum, a) => sum + a.diffStats.deletions, 0);
        const waitingCount = agents.filter(a =>
            a.status === 'waiting-input' || a.status === 'waiting-approval'
        ).length;
        const workingCount = agents.filter(a => a.status === 'working').length;
        const containerizedCount = agents.filter(a => a.isolationTier && a.isolationTier !== 'standard').length;

        // Group agents by repository
        const agentsByRepo = this._groupAgentsByRepo(agents);
        const repoSections = this._getRepoSections(agentsByRepo);

        return `
            <div class="stats-bar">
                <div class="stats-title">Opus Orchestra Dashboard</div>
                <div class="stat">
                    <div class="stat-value">${agents.length}</div>
                    <div class="stat-label">Total Agents</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${workingCount}</div>
                    <div class="stat-label">Working</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${waitingCount}</div>
                    <div class="stat-label">Waiting</div>
                </div>
                ${containerizedCount > 0 ? `
                <div class="stat">
                    <div class="stat-value" style="color: #2196F3;">📦 ${containerizedCount}</div>
                    <div class="stat-label">Containerized</div>
                </div>
                ` : ''}
                <div class="stat">
                    <div class="stat-value diff-add">+${totalInsertions}</div>
                    <div class="stat-label">Insertions</div>
                </div>
                <div class="stat">
                    <div class="stat-value diff-del">-${totalDeletions}</div>
                    <div class="stat-label">Deletions</div>
                </div>
            </div>
            ${repoSections}
        `;
    }

    private _groupAgentsByRepo(agents: Agent[]): Map<string, Agent[]> {
        const persistenceService = getPersistenceService();
        const grouped = new Map<string, Agent[]>();

        for (const agent of agents) {
            const repoPath = agent.repoPath || 'Unknown';
            if (!grouped.has(repoPath)) {
                grouped.set(repoPath, []);
            }
            grouped.get(repoPath)!.push(agent);
        }

        // Sort each group by saved order
        for (const [repoPath, repoAgents] of grouped) {
            const orderMap = persistenceService.getAgentOrder(repoPath);
            repoAgents.sort((a, b) => {
                const orderA = orderMap[a.id] ?? Number.MAX_SAFE_INTEGER;
                const orderB = orderMap[b.id] ?? Number.MAX_SAFE_INTEGER;
                // If both have no order, sort by ID (creation order)
                if (orderA === Number.MAX_SAFE_INTEGER && orderB === Number.MAX_SAFE_INTEGER) {
                    return a.id - b.id;
                }
                return orderA - orderB;
            });
        }

        return grouped;
    }

    private _getRepoSections(agentsByRepo: Map<string, Agent[]>): string {
        const repoPaths = this._agentManager.getRepositoryPaths();
        const sections: string[] = [];

        // First, add sections for repos that have agents
        for (const [repoPath, repoAgents] of agentsByRepo) {
            const repoName = repoPath.split(/[/\\]/).pop() || repoPath;
            const repoIndex = repoPaths.indexOf(repoPath);
            const agentCards = repoAgents.map(agent => this._getAgentCard(agent)).join('');

            sections.push(`
                <div class="repo-section">
                    <div class="repo-header">
                        <div class="repo-title">
                            ${this._escapeHtml(repoName)}
                            <span class="repo-path">${this._escapeHtml(repoPath)}</span>
                        </div>
                        <div class="repo-actions">
                            <button class="btn btn-primary btn-small" data-action="addAgentToRepo" data-repo-index="${repoIndex >= 0 ? repoIndex : 0}">+ Add Agent</button>
                        </div>
                    </div>
                    <div class="agents-grid">
                        ${agentCards}
                    </div>
                </div>
            `);
        }

        // Add empty sections for configured repos without agents
        for (let i = 0; i < repoPaths.length; i++) {
            const repoPath = repoPaths[i];
            if (!agentsByRepo.has(repoPath)) {
                const repoName = repoPath.split(/[/\\]/).pop() || repoPath;
                sections.push(`
                    <div class="repo-section">
                        <div class="repo-header">
                            <div class="repo-title">
                                ${this._escapeHtml(repoName)}
                                <span class="repo-path">${this._escapeHtml(repoPath)}</span>
                            </div>
                            <div class="repo-actions">
                                <button class="btn btn-primary btn-small" data-action="addAgentToRepo" data-repo-index="${i}">+ Add Agent</button>
                            </div>
                        </div>
                        <div class="agents-grid">
                            <div style="color: var(--vscode-descriptionForeground); padding: 16px;">No agents in this repository</div>
                        </div>
                    </div>
                `);
            }
        }

        return sections.join('');
    }

    private _getAgentTodoHtml(sessionId: string): string {
        const items = getTodoService().getTodosForSession(sessionId);
        if (!items || items.length === 0) {
            return '';
        }

        const completedCount = items.filter(i => i.status === 'completed').length;
        const totalCount = items.length;
        const progressPercent = Math.round((completedCount / totalCount) * 100);

        const itemsHtml = items.map(item => this._getTodoItemHtml(item)).join('');

        return `
            <div class="todo-section">
                <div class="todo-header">
                    <span class="todo-title">Tasks</span>
                    <span class="todo-meta">${completedCount}/${totalCount} (${progressPercent}%)</span>
                </div>
                <ul class="todo-list">
                    ${itemsHtml}
                </ul>
            </div>
        `;
    }

    private _getTodoItemHtml(item: TodoItem): string {
        const icon = item.status === 'completed' ? '✓'
            : item.status === 'in_progress' ? '▶'
            : '○';

        // Show activeForm when in_progress, otherwise show content
        const text = (item.status === 'in_progress' && item.activeForm)
            ? item.activeForm
            : item.content;

        return `
            <li class="todo-item">
                <span class="todo-icon ${item.status}">${icon}</span>
                <div class="todo-content ${item.status}">${this._escapeHtml(text)}</div>
            </li>
        `;
    }

    private _getEmptyState(): string {
        const repoPaths = this._agentManager.getRepositoryPaths();
        const defaultRepo = repoPaths.length > 0 ? repoPaths[0] : 'No repository configured';
        const repoName = defaultRepo.split(/[/\\]/).pop() || defaultRepo;

        const config = vscode.workspace.getConfiguration('claudeAgents');
        const defaultAgentCount = config.get<number>('defaultAgentCount', 3);
        const defaultTier = config.get<string>('isolationTier', 'standard');

        const repoOptions = repoPaths.map((p, i) => {
            const name = p.split(/[/\\]/).pop() || p;
            return `<option value="${i}" ${i === 0 ? 'selected' : ''}>${name}</option>`;
        }).join('');

        const tierOptions = this._availableTiers.map(t => {
            const label = this._getTierLabel(t);
            const icon = this._getTierIcon(t);
            return `<option value="${t}" ${t === defaultTier ? 'selected' : ''}>${icon} ${label}</option>`;
        }).join('');

        return `
            <div class="empty-state">
                <h2>No Agents Created</h2>
                <p>Create agent worktrees to start running multiple Claude instances in parallel.</p>
                <div class="create-form">
                    ${repoPaths.length > 1 ? `
                        <label>Repository:</label>
                        <select id="repo-select" style="padding: 8px; border-radius: 4px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground);">
                            ${repoOptions}
                        </select>
                    ` : `
                        <span style="color: var(--vscode-descriptionForeground);">Repository: <strong>${repoName}</strong></span>
                    `}
                </div>
                <div class="create-form" style="margin-top: 16px;">
                    <label>Isolation:</label>
                    <select id="isolation-tier-select" class="tier-select">
                        ${tierOptions}
                    </select>
                </div>
                <div class="create-form" style="margin-top: 16px;">
                    <label>Number of agents:</label>
                    <input type="number" id="agent-count" value="${defaultAgentCount}" min="1" max="10">
                    <button class="btn btn-primary" data-action="createAgents">Create Agents</button>
                </div>
            </div>
        `;
    }

    private _getLoadingIndicator(): string {
        if (!this._activeOperation) {
            return '';
        }

        const { message, current, total } = this._activeOperation;
        const hasProgress = current !== undefined && total !== undefined && total > 0;
        const percent = hasProgress ? Math.round((current! / total!) * 100) : 0;

        return `
            <div class="loading-overlay">
                <div class="loading-spinner"></div>
                <div class="loading-content">
                    <div class="loading-message">${this._escapeHtml(message)}</div>
                    ${hasProgress ? `
                    <div class="loading-progress">
                        <div class="loading-bar">
                            <div class="loading-bar-fill" style="width: ${percent}%"></div>
                        </div>
                        <span class="loading-percent">${current}/${total}</span>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    private _getTierLabel(tier: IsolationTier): string {
        switch (tier) {
            case 'standard': return 'Standard';
            case 'sandbox': return 'Sandbox';
            case 'docker': return 'Docker';
            case 'gvisor': return 'gVisor';
            case 'firecracker': return 'Firecracker';
            default: return tier;
        }
    }

    private _getTierIcon(tier: IsolationTier): string {
        switch (tier) {
            case 'standard': return '';
            case 'sandbox': return '🛡️';
            case 'docker': return '📦';
            case 'gvisor': return '📦';
            case 'firecracker': return '🖥️';
            default: return '';
        }
    }

    private _getAgentCard(agent: Agent): string {
        const timeSince = formatTimeSince(agent.lastInteractionTime, true);
        const isWaiting = agent.status === 'waiting-input' || agent.status === 'waiting-approval';
        const needsApproval = agent.status === 'waiting-approval';
        const statusClass = agent.status === 'working' ? 'status-working'
            : isWaiting ? 'status-waiting'
            : agent.status === 'stopped' ? 'status-stopped'
            : agent.status === 'error' ? 'status-error'
            : 'status-idle';

        // Display name (agent.name is already without "claude-" prefix)
        const displayName = agent.name;

        // Isolation tier info
        const tier = agent.isolationTier || 'standard';
        const isContainerized = tier !== 'standard';
        const tierClass = `tier-${tier}`;

        // Container state and stats
        const containerState = agent.containerInfo?.state || 'not_created';
        const stats = this._containerStats.get(agent.id);

        // Build tier options for dropdown
        const tierOptions = this._availableTiers.map(t => {
            const label = this._getTierLabel(t);
            const icon = this._getTierIcon(t);
            return `<option value="${t}" ${t === tier ? 'selected' : ''}>${icon} ${label}</option>`;
        }).join('');

        // Check setting for showing all permission options
        const config = vscode.workspace.getConfiguration('claudeAgents');
        const showAllOptions = config.get<boolean>('showAllPermissionOptions', false);

        return `
            <div class="agent-card ${isWaiting ? 'waiting' : ''} ${isContainerized ? 'containerized ' + tierClass : ''}"
                 draggable="true"
                 data-agent-id="${agent.id}"
                 data-repo-path="${this._escapeHtml(agent.repoPath)}">
                <div class="agent-header">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="text" class="agent-title-input" value="${displayName}" data-agent-id="${agent.id}" data-original="${displayName}" title="Click to rename">
                        ${isContainerized ? `<span class="container-state ${containerState}">${containerState}</span>` : ''}
                    </div>
                    <span class="agent-status ${statusClass}">${agent.status}</span>
                </div>
                ${isContainerized && stats ? `
                <div class="container-stats">
                    <div class="container-stat">
                        <span class="container-stat-label">Memory:</span>
                        <span class="container-stat-value">${stats.memoryMB.toFixed(0)} MB</span>
                    </div>
                    <div class="container-stat">
                        <span class="container-stat-label">CPU:</span>
                        <span class="container-stat-value">${stats.cpuPercent.toFixed(1)}%</span>
                    </div>
                </div>
                ` : ''}
                <div class="agent-stats">
                    <div class="stat-item">
                        <span class="stat-label">${agent.status === 'working' ? 'Working' : 'Waiting'}</span>
                        <span class="stat-value">${timeSince}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Changes</span>
                        <div class="diff-stats">
                            <span class="diff-add">+${agent.diffStats.insertions}</span>
                            <span class="diff-del">-${agent.diffStats.deletions}</span>
                            <button class="btn-icon" data-action="viewDiff" data-agent-id="${agent.id}" title="View diff">📄</button>
                        </div>
                    </div>
                </div>
                <div class="agent-actions">
                    <button class="btn btn-small btn-primary" data-action="focus" data-agent-id="${agent.id}">${agent.terminal ? 'Focus Terminal' : 'Open Terminal'}</button>
                    <button class="btn btn-small btn-primary" data-action="startClaude" data-agent-id="${agent.id}">Start Claude</button>
                    <select class="tier-select tier-select-small" data-action="changeIsolation" data-agent-id="${agent.id}" title="Change isolation tier">
                        ${tierOptions}
                    </select>
                    <button class="btn btn-small btn-danger" data-action="deleteAgent" data-agent-id="${agent.id}" title="Delete agent">🗑️</button>
                </div>
                ${this._getAgentTodoHtml(agent.sessionId)}
                ${needsApproval ? `
                <div class="approval-context">${this._escapeHtml(agent.pendingApproval || 'Permission required')}</div>
                <div class="approval-actions">
                    <button class="btn btn-small btn-primary" data-action="sendKey" data-agent-id="${agent.id}" data-key="1" title="Yes, allow this action">Allow</button>
                    ${showAllOptions ? `<button class="btn btn-small btn-primary" data-action="sendKey" data-agent-id="${agent.id}" data-key="2" title="Allow and remember">Always</button>` : ''}
                    <button class="btn btn-small btn-muted" data-action="focus" data-agent-id="${agent.id}" title="Go to terminal to reject or provide instructions">Respond...</button>
                </div>
                ` : ''}
            </div>
        `;
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    public dispose() {
        AgentPanel.currentPanel = undefined;

        // Unsubscribe from EventBus
        const eventBus = getEventBus();
        eventBus.off('agent:created', this._updateHandler);
        eventBus.off('agent:deleted', this._updateHandler);
        eventBus.off('agent:renamed', this._updateHandler);
        eventBus.off('agent:terminalClosed', this._updateHandler);
        eventBus.off('agent:statusChanged', this._updateHandler);
        eventBus.off('approval:pending', this._updateHandler);
        eventBus.off('approval:resolved', this._updateHandler);
        eventBus.off('status:refreshed', this._updateHandler);
        eventBus.off('diffStats:refreshed', this._updateHandler);

        // Unsubscribe from operation events
        eventBus.off('operation:started', this._operationStartedHandler);
        eventBus.off('operation:progress', this._operationProgressHandler);
        eventBus.off('operation:completed', this._operationCompletedHandler);
        eventBus.off('operation:failed', this._operationCompletedHandler);

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
