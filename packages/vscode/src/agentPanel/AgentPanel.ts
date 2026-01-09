/**
 * AgentPanel - VS Code webview panel for the Claude Agents Dashboard
 *
 * This is the refactored version using Svelte for the webview UI.
 * The webview is compiled separately and loaded from out/webview/agentPanel.js
 */

import * as vscode from 'vscode';
import { AgentManager } from '../agentManager';
import {
    getTodoService,
    TodoItem,
    getEventBus,
    getPersistenceService,
    getContainerConfigService,
    DiscoveredConfig,
    getLogger,
    isLoggerInitialized,
} from '../services';
import {
    WebviewIncomingMessage,
    WebviewOutgoingMessage,
    AgentUpdate,
    ContainerGroup,
    TodoItemUpdate,
    agentToUpdate,
} from './types';

export class AgentPanel {
    public static currentPanel: AgentPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _agentManager: AgentManager;
    private readonly _extensionUri: vscode.Uri;
    private readonly _logger = isLoggerInitialized() ? getLogger().child('AgentPanel') : null;

    private _disposables: vscode.Disposable[] = [];
    private _availableConfigs: DiscoveredConfig[] = [];
    private _lastAgentIds: Set<number> = new Set();

    // Event handlers bound to this instance
    private readonly _updateHandler = () => this._update();

    private constructor(panel: vscode.WebviewPanel, agentManager: AgentManager, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._agentManager = agentManager;
        this._extensionUri = extensionUri;

        // Set up panel
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            (message: WebviewIncomingMessage) => this._handleMessage(message),
            null,
            this._disposables
        );

        // Subscribe to EventBus events
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

        // Load available container configs
        this._loadContainerConfigs();

        // Initial render
        this._panel.webview.html = this._getHtml();
    }

    public static show(agentManager: AgentManager) {
        const extensionUri = vscode.extensions.getExtension('kyleherndon.opus-orchestra')?.extensionUri
            || vscode.Uri.file(__dirname);

        if (AgentPanel.currentPanel) {
            AgentPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'claudeAgentsDashboard',
            'Claude Agents Dashboard',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'out', 'webview'),
                ],
            }
        );

        AgentPanel.currentPanel = new AgentPanel(panel, agentManager, extensionUri);
    }

    private _postMessage(message: WebviewOutgoingMessage): void {
        this._panel.webview.postMessage(message);
    }

    private async _loadContainerConfigs(): Promise<void> {
        const repoPaths = this._agentManager.getRepositoryPaths();
        const configService = getContainerConfigService();
        const allConfigs: DiscoveredConfig[] = [];

        for (const repoPath of repoPaths) {
            const configs = await configService.discoverConfigs(repoPath);
            allConfigs.push(...configs);
        }

        this._availableConfigs = allConfigs;
    }

    private _getContainerGroups(): ContainerGroup[] {
        const groups: ContainerGroup[] = [];

        // Always add unisolated option
        groups.push({
            label: '',
            options: [{ value: 'unisolated', label: 'Unisolated' }],
        });

        // Group configs by source and type
        const repoConfigs = this._availableConfigs.filter(c => c.source === 'repo');
        const userConfigs = this._availableConfigs.filter(c => c.source === 'user');

        // Helper to add groups by type within a source
        const addGroupsByType = (configs: DiscoveredConfig[], sourceLabel: string) => {
            const dockerConfigs = configs.filter(c => c.configRef.type === 'docker');
            const chvConfigs = configs.filter(c => c.configRef.type === 'cloud-hypervisor');
            const otherConfigs = configs.filter(c =>
                c.configRef.type !== 'docker' && c.configRef.type !== 'cloud-hypervisor'
            );

            if (dockerConfigs.length > 0) {
                groups.push({
                    label: `${sourceLabel} - Docker`,
                    options: dockerConfigs.map(c => ({
                        value: c.prefixedName,
                        label: this._getConfigLabel(c),
                    })),
                });
            }

            if (chvConfigs.length > 0) {
                groups.push({
                    label: `${sourceLabel} - Cloud Hypervisor`,
                    options: chvConfigs.map(c => ({
                        value: c.prefixedName,
                        label: this._getConfigLabel(c),
                    })),
                });
            }

            if (otherConfigs.length > 0) {
                groups.push({
                    label: sourceLabel,
                    options: otherConfigs.map(c => ({
                        value: c.prefixedName,
                        label: this._getConfigLabel(c),
                    })),
                });
            }
        };

        if (repoConfigs.length > 0) {
            addGroupsByType(repoConfigs, 'Repository');
        }

        if (userConfigs.length > 0) {
            addGroupsByType(userConfigs, 'User');
        }

        return groups;
    }

    private _getConfigLabel(config: DiscoveredConfig): string {
        const displayName = config.prefixedName.replace(/^(repo:|user:)/, '');
        return displayName;
    }

    private _getTodoItems(sessionId: string): TodoItemUpdate[] {
        const items = getTodoService().getTodosForSession(sessionId);
        if (!items) {
            return [];
        }
        return items.map((item: TodoItem) => ({
            status: item.status,
            content: item.content,
            activeForm: item.activeForm,
        }));
    }

    private _getAgentUpdates(): AgentUpdate[] {
        return this._agentManager.getAgents().map(agent =>
            agentToUpdate(agent, this._getTodoItems(agent.sessionId))
        );
    }

    /**
     * Send initial state to the webview
     */
    private _sendInit(): void {
        const config = vscode.workspace.getConfiguration('claudeAgents');
        const uiScale = config.get<number>('uiScale', 1.0);

        this._postMessage({
            command: 'init',
            agents: this._getAgentUpdates(),
            repoPaths: this._agentManager.getRepositoryPaths(),
            containerGroups: this._getContainerGroups(),
            uiScale,
        });
    }

    /**
     * Incremental update - sends only changed data
     */
    private _update(): void {
        const agents = this._agentManager.getAgents();
        const currentIds = new Set(agents.map(a => a.id));

        // Find added and removed agents
        const addedIds = [...currentIds].filter(id => !this._lastAgentIds.has(id));
        const removedIds = [...this._lastAgentIds].filter(id => !currentIds.has(id));

        // Handle removals
        for (const id of removedIds) {
            this._postMessage({ command: 'removeCard', agentId: id });
        }

        // Handle additions
        for (const id of addedIds) {
            const agent = agents.find(a => a.id === id);
            if (agent) {
                this._postMessage({
                    command: 'addCard',
                    agent: agentToUpdate(agent, this._getTodoItems(agent.sessionId)),
                });
            }
        }

        // Update tracked IDs
        this._lastAgentIds = currentIds;

        // Send status updates for all agents
        this._postMessage({
            command: 'updateAgents',
            agents: this._getAgentUpdates(),
        });
    }

    /**
     * Handle messages from the webview
     */
    private async _handleMessage(message: WebviewIncomingMessage): Promise<void> {
        this._logger?.debug(`Received message: ${message.command}`);

        switch (message.command) {
            case 'webviewReady':
                this._sendInit();
                break;

            case 'focus':
                if (message.agentId !== undefined) {
                    await this._agentManager.focusAgent(message.agentId);
                }
                break;

            case 'startClaude':
                if (message.agentId !== undefined) {
                    await this._agentManager.startClaudeInAgent(message.agentId);
                }
                break;

            case 'deleteAgent':
                if (message.agentId !== undefined) {
                    const confirmed = await vscode.window.showWarningMessage(
                        'Delete this agent and its worktree?',
                        { modal: true },
                        'Delete'
                    );
                    if (confirmed === 'Delete') {
                        await this._agentManager.deleteAgent(message.agentId);
                    }
                }
                break;

            case 'viewDiff':
                if (message.agentId !== undefined) {
                    await this._agentManager.showAgentDiff(message.agentId);
                }
                break;

            case 'sendKey':
                if (message.agentId !== undefined && message.key) {
                    this._agentManager.sendToAgent(message.agentId, message.key);
                }
                break;

            case 'renameAgent':
                if (message.agentId !== undefined && message.newName) {
                    await this._agentManager.renameAgent(message.agentId, message.newName);
                }
                break;

            case 'changeContainerConfig':
                if (message.agentId !== undefined && message.configName) {
                    await this._agentManager.changeAgentContainerConfig(message.agentId, message.configName);
                }
                break;

            case 'createAgents':
                if (message.count !== undefined) {
                    const repoPaths = this._agentManager.getRepositoryPaths();
                    const repoIndex = message.repoIndex ?? 0;
                    const repoPath = repoPaths[repoIndex];
                    if (repoPath) {
                        this._postMessage({
                            command: 'loading',
                            active: true,
                            message: `Creating ${message.count} agents...`,
                        });
                        try {
                            await this._agentManager.createAgents(
                                message.count,
                                repoPath,
                                message.containerConfigName
                            );
                        } finally {
                            this._postMessage({ command: 'loading', active: false });
                        }
                    }
                }
                break;

            case 'addAgentToRepo':
                if (message.repoIndex !== undefined) {
                    const repoPaths = this._agentManager.getRepositoryPaths();
                    const repoPath = repoPaths[message.repoIndex];
                    if (repoPath) {
                        await this._agentManager.createAgents(1, repoPath);
                    }
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
                    this._postMessage({
                        command: 'swapCards',
                        sourceAgentId: message.sourceAgentId,
                        targetAgentId: message.targetAgentId,
                    });
                }
                break;
        }
    }

    /**
     * Handle agent reordering via drag-drop
     */
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
            if (!(agent.id in orderMap)) {
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

    /**
     * Generate the HTML for the webview
     */
    private _getHtml(): string {
        const webviewUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'agentPanel.js')
        );

        // Get UI scale for CSS variable
        const config = vscode.workspace.getConfiguration('claudeAgents');
        const uiScale = config.get<number>('uiScale', 1.0);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${this._panel.webview.cspSource};">
    <title>Claude Agents Dashboard</title>
    <style>
        :root {
            --ui-scale: ${uiScale};
        }
    </style>
</head>
<body>
    <script src="${webviewUri}"></script>
</body>
</html>`;
    }

    public dispose(): void {
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

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
