import * as vscode from 'vscode';
import { AgentManager, Agent } from './agentManager';
import { formatTimeSince } from './types';

export class AgentPanel {
    public static currentPanel: AgentPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _agentManager: AgentManager;
    private _disposables: vscode.Disposable[] = [];
    private _updateInterval: NodeJS.Timeout | undefined;

    private constructor(panel: vscode.WebviewPanel, agentManager: AgentManager) {
        this._panel = panel;
        this._agentManager = agentManager;

        this._update();

        // Update every second
        this._updateInterval = setInterval(() => this._update(), 1000);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            null,
            this._disposables
        );
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

    private async _handleMessage(message: any) {
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
                if (agentId !== undefined) {
                    this._agentManager.sendToAgent(agentId, message.text);
                }
                break;
            case 'startClaude':
                if (agentId !== undefined) {
                    await this._agentManager.startClaudeInAgent(agentId);
                }
                break;
            case 'createAgents':
                const repoPaths = this._agentManager.getRepositoryPaths();
                const selectedRepo = repoPaths[message.repoIndex] || repoPaths[0];
                await this._agentManager.createAgents(message.count, selectedRepo);
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
            case 'addAgent':
                const repos = this._agentManager.getRepositoryPaths();
                if (repos.length > 0) {
                    await this._agentManager.createAgents(1, repos[0]);
                }
                break;
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
        }
        this._update();
    }

    private _update() {
        const agents = this._agentManager.getAgents();
        this._panel.webview.html = this._getHtml(agents);
    }

    private _getHtml(agents: Agent[]): string {
        const agentCards = agents.map(agent => this._getAgentCard(agent)).join('');
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
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: calc(24px * var(--ui-scale));
            padding-bottom: calc(16px * var(--ui-scale));
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        .header h1 {
            font-size: calc(24px * var(--ui-scale));
            font-weight: 600;
        }
        .header-actions {
            display: flex;
            gap: calc(8px * var(--ui-scale));
            align-items: center;
        }
        .scale-control {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: calc(12px * var(--ui-scale));
            color: var(--vscode-descriptionForeground);
        }
        .scale-control select {
            padding: 4px;
            border-radius: 4px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-size: calc(12px * var(--ui-scale));
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
    </style>
</head>
<body>
    <div class="header">
        <h1>Claude Agents Dashboard</h1>
        <div class="header-actions">
            <div class="scale-control">
                <label>Scale:</label>
                <select id="scale-select">
                    <option value="0.75" ${uiScale === 0.75 ? 'selected' : ''}>75%</option>
                    <option value="0.875" ${uiScale === 0.875 ? 'selected' : ''}>87.5%</option>
                    <option value="1" ${uiScale === 1.0 ? 'selected' : ''}>100%</option>
                    <option value="1.125" ${uiScale === 1.125 ? 'selected' : ''}>112.5%</option>
                    <option value="1.25" ${uiScale === 1.25 ? 'selected' : ''}>125%</option>
                    <option value="1.5" ${uiScale === 1.5 ? 'selected' : ''}>150%</option>
                </select>
            </div>
            ${hasAgents ? `
                <button class="btn btn-primary" data-action="addAgent">+ Add Agent</button>
                <button class="btn btn-secondary" data-action="refresh">Refresh</button>
            ` : ''}
        </div>
    </div>

    ${hasAgents ? this._getAgentsDashboard(agents, agentCards) : this._getEmptyState()}

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
                        vscode.postMessage({ command: 'createAgents', count: count, repoIndex: repoIndex });
                        break;
                    case 'addAgent':
                        vscode.postMessage({ command: 'addAgent' });
                        break;
                    case 'refresh':
                        location.reload();
                        break;
                }
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

            // Scale selector handler
            const scaleSelect = document.getElementById('scale-select');
            if (scaleSelect) {
                scaleSelect.addEventListener('change', function(e) {
                    const newScale = parseFloat(e.target.value);
                    vscode.postMessage({ command: 'setScale', scale: newScale });
                });
            }
        })();
    </script>
</body>
</html>`;
    }

    private _getAgentsDashboard(agents: Agent[], agentCards: string): string {
        const totalInsertions = agents.reduce((sum, a) => sum + a.diffStats.insertions, 0);
        const totalDeletions = agents.reduce((sum, a) => sum + a.diffStats.deletions, 0);
        const waitingCount = agents.filter(a =>
            a.status === 'waiting-input' || a.status === 'waiting-approval'
        ).length;
        const workingCount = agents.filter(a => a.status === 'working').length;
        const containerizedCount = agents.filter(a => a.isolationTier && a.isolationTier !== 'standard').length;

        return `
            <div class="stats-bar">
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
            <div class="agents-grid">
                ${agentCards}
            </div>
        `;
    }

    private _getEmptyState(): string {
        const repoPaths = this._agentManager.getRepositoryPaths();
        const defaultRepo = repoPaths.length > 0 ? repoPaths[0] : 'No repository configured';
        const repoName = defaultRepo.split(/[/\\]/).pop() || defaultRepo;

        const config = vscode.workspace.getConfiguration('claudeAgents');
        const defaultAgentCount = config.get<number>('defaultAgentCount', 3);

        const repoOptions = repoPaths.map((p, i) => {
            const name = p.split(/[/\\]/).pop() || p;
            return `<option value="${i}" ${i === 0 ? 'selected' : ''}>${name}</option>`;
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
                    <label>Number of agents:</label>
                    <input type="number" id="agent-count" value="${defaultAgentCount}" min="1" max="10">
                    <button class="btn btn-primary" data-action="createAgents">Create Agents</button>
                </div>
            </div>
        `;
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
        const tierIcon = tier === 'docker' || tier === 'gvisor' ? '📦'
            : tier === 'sandbox' ? '🛡️'
            : tier === 'firecracker' ? '🖥️'
            : '';
        const tierLabel = tier === 'gvisor' ? 'gVisor' : tier.charAt(0).toUpperCase() + tier.slice(1);

        // Check setting for showing all permission options
        const config = vscode.workspace.getConfiguration('claudeAgents');
        const showAllOptions = config.get<boolean>('showAllPermissionOptions', false);

        return `
            <div class="agent-card ${isWaiting ? 'waiting' : ''} ${isContainerized ? 'containerized ' + tierClass : ''}">
                <div class="agent-header">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="text" class="agent-title-input" value="${displayName}" data-agent-id="${agent.id}" data-original="${displayName}" title="Click to rename">
                        ${isContainerized ? `<span class="isolation-badge isolation-${tier}" title="Running in ${tierLabel} isolation">${tierIcon} ${tierLabel}</span>` : ''}
                    </div>
                    <span class="agent-status ${statusClass}">${agent.status}</span>
                </div>
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
                    <button class="btn btn-small btn-danger" data-action="deleteAgent" data-agent-id="${agent.id}" title="Delete agent">🗑️</button>
                </div>
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

        if (this._updateInterval) {
            clearInterval(this._updateInterval);
        }

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
