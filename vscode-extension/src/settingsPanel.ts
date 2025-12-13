import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { getConfigService } from './services';
import { agentPath } from './pathUtils';

// Get extension version from package.json
// eslint-disable-next-line @typescript-eslint/no-var-requires
const EXTENSION_VERSION = require('../package.json').version as string;

type SettingsValue = string | number | boolean | string[];

// Settings keys with their default values (must match SETTINGS_SCHEMA in webview JS)
const SETTINGS_KEYS: Record<string, SettingsValue> = {
    repositoryPaths: [],
    defaultAgentCount: 3,
    claudeCommand: 'claude',
    autoStartClaude: false,
    diffPollingInterval: 60000,
    worktreeDirectory: '.worktrees',
    coordinationScriptsPath: '',
    backlogPath: '',
    terminalType: 'bash',
    uiScale: 1.0
};

export class SettingsPanel {
    public static currentPanel: SettingsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, _extensionUri: vscode.Uri) {
        this._panel = panel;
        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            null,
            this._disposables
        );
    }

    public static show(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (SettingsPanel.currentPanel) {
            SettingsPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'agentSettings',
            'Claude Agents Settings',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        SettingsPanel.currentPanel = new SettingsPanel(panel, extensionUri);
    }

    private async _handleMessage(message: { command: string; fieldId?: string } & Record<string, unknown>) {
        const config = vscode.workspace.getConfiguration('claudeAgents');

        switch (message.command) {
            case 'saveSettings':
                for (const key of Object.keys(SETTINGS_KEYS)) {
                    if (message[key] !== undefined) {
                        await config.update(key, message[key], vscode.ConfigurationTarget.Global);
                    }
                }
                // Refresh ConfigService to pick up new values
                getConfigService().refresh();
                vscode.window.showInformationMessage('Settings saved');
                break;

            case 'browseDirectory': {
                const uri = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    title: 'Select Git Repository'
                });
                if (uri && uri[0]) {
                    this._panel.webview.postMessage({
                        command: 'directorySelected',
                        path: uri[0].fsPath
                    });
                }
                break;
            }

            case 'browseForPath': {
                const pathUri = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    title: message.fieldId === 'backlogPath' ? 'Select Backlog Directory' : 'Select Directory'
                });
                if (pathUri && pathUri[0]) {
                    this._panel.webview.postMessage({
                        command: 'pathSelected',
                        fieldId: message.fieldId,
                        path: pathUri[0].fsPath
                    });
                }
                break;
            }

            case 'getSettings':
                this._sendCurrentSettings();
                break;

            case 'validateRepo': {
                const repoPath = message.path as string;
                const isValid = this._isValidGitRepo(repoPath);
                this._panel.webview.postMessage({
                    command: 'repoValidated',
                    path: repoPath,
                    isValid,
                    error: isValid ? null : 'Not a valid git repository'
                });
                break;
            }
        }
    }

    private _isValidGitRepo(repoPath: string): boolean {
        try {
            const fsPath = agentPath(repoPath).forNodeFs();
            execSync('git rev-parse --git-dir', { cwd: fsPath, stdio: 'pipe' });
            return true;
        } catch {
            return false;
        }
    }

    private _sendCurrentSettings() {
        const config = vscode.workspace.getConfiguration('claudeAgents');
        const settings: Record<string, SettingsValue> = {};
        for (const [key, defaultValue] of Object.entries(SETTINGS_KEYS)) {
            settings[key] = config.get(key, defaultValue);
        }
        this._panel.webview.postMessage({ command: 'settingsLoaded', settings });
    }

    private _update() {
        this._panel.webview.html = this._getHtml();
        // Send settings after a short delay to ensure webview is ready
        setTimeout(() => this._sendCurrentSettings(), 100);
    }

    private _getHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude Agents Settings</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 20px;
            max-width: 800px;
            margin: 0 auto;
        }
        h1 {
            font-size: 24px;
            margin-bottom: 24px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        h2 {
            font-size: 16px;
            margin: 24px 0 12px 0;
            color: var(--vscode-textLink-foreground);
        }
        .setting-group {
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 16px;
        }
        .setting-item {
            margin-bottom: 16px;
        }
        .setting-item:last-child {
            margin-bottom: 0;
        }
        .setting-label {
            display: block;
            margin-bottom: 6px;
            font-weight: 500;
        }
        .setting-description {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
        }
        input[type="text"],
        input[type="number"] {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-family: inherit;
            font-size: 13px;
        }
        input[type="number"] {
            width: 120px;
        }
        input[type="checkbox"] {
            margin-right: 8px;
        }
        .checkbox-label {
            display: flex;
            align-items: center;
            cursor: pointer;
        }
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-family: inherit;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .repo-list {
            margin-bottom: 12px;
        }
        .repo-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            margin-bottom: 8px;
        }
        .repo-item input {
            flex: 1;
            border: none;
            background: transparent;
            padding: 0;
        }
        .repo-item .btn {
            padding: 4px 8px;
            font-size: 12px;
        }
        .repo-item.valid {
            border-color: var(--vscode-gitDecoration-addedResourceForeground);
        }
        .repo-item.invalid {
            border-color: var(--vscode-inputValidation-errorBorder);
            background: var(--vscode-inputValidation-errorBackground);
        }
        .repo-status {
            font-size: 12px;
            padding: 0 4px;
        }
        .repo-status.valid {
            color: var(--vscode-gitDecoration-addedResourceForeground);
        }
        .repo-status.invalid {
            color: var(--vscode-inputValidation-errorForeground);
        }
        .repo-status.pending {
            color: var(--vscode-descriptionForeground);
        }
        .btn-icon {
            padding: 4px 8px;
            background: transparent;
            color: var(--vscode-editor-foreground);
            border: 1px solid var(--vscode-widget-border);
        }
        .btn-icon:hover {
            background: var(--vscode-button-secondaryBackground);
        }
        .btn-danger {
            background: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-inputValidation-errorForeground);
        }
        .add-repo-row {
            display: flex;
            gap: 8px;
        }
        .actions {
            margin-top: 24px;
            padding-top: 16px;
            border-top: 1px solid var(--vscode-widget-border);
            display: flex;
            gap: 12px;
        }
        .empty-repos {
            padding: 16px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        .path-input-row {
            display: flex;
            gap: 8px;
        }
        .path-input-row input {
            flex: 1;
        }
        select {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-family: inherit;
            font-size: 13px;
        }
        .version-footer {
            margin-top: 32px;
            padding-top: 16px;
            border-top: 1px solid var(--vscode-widget-border);
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        .version-footer a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }
        .version-footer a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <h1>Claude Agents Settings</h1>

    <h2>Repository Directories</h2>
    <div class="setting-group">
        <div class="setting-description">
            Specify git repository paths where agents can work. Leave empty to use the current workspace.
        </div>
        <div class="repo-list" id="repoList">
            <div class="empty-repos">No repositories configured. Using current workspace.</div>
        </div>
        <div class="add-repo-row">
            <button class="btn btn-secondary" onclick="browseDirectory()">Browse...</button>
            <button class="btn btn-secondary" onclick="addEmptyRepo()">Add Manually</button>
        </div>
    </div>

    <h2>Agent Settings</h2>
    <div class="setting-group">
        <div class="setting-item">
            <label class="setting-label">Default Agent Count</label>
            <div class="setting-description">Number of agents to create by default (1-10)</div>
            <input type="number" id="defaultAgentCount" min="1" max="10" value="3">
        </div>
        <div class="setting-item">
            <label class="setting-label">Worktree Directory</label>
            <div class="setting-description">Directory name for agent worktrees (relative to repo root)</div>
            <input type="text" id="worktreeDirectory" value=".worktrees">
        </div>
    </div>

    <h2>Claude Settings</h2>
    <div class="setting-group">
        <div class="setting-item">
            <label class="setting-label">Claude Command</label>
            <div class="setting-description">Command to start Claude Code in terminal</div>
            <input type="text" id="claudeCommand" value="claude">
        </div>
        <div class="setting-item">
            <label class="checkbox-label">
                <input type="checkbox" id="autoStartClaude">
                Auto-start Claude when creating agent terminals
            </label>
        </div>
    </div>

    <h2>Terminal Environment</h2>
    <div class="setting-group">
        <div class="setting-item">
            <label class="setting-label">Terminal Type</label>
            <div class="setting-description">Select which terminal/shell to use for running git commands. This affects path formatting.</div>
            <select id="terminalType">
                <option value="bash">Bash (macOS/Linux) - Native shell</option>
                <option value="wsl">WSL (Windows Subsystem for Linux) - /mnt/c/... paths</option>
                <option value="gitbash">Git Bash - /c/... paths</option>
                <option value="powershell">PowerShell - C:\\ paths</option>
                <option value="cmd">Command Prompt (CMD) - C:\\ paths</option>
            </select>
        </div>
        <div class="setting-item">
            <label class="setting-label">Dashboard UI Scale</label>
            <div class="setting-description">Adjust the size of the dashboard UI elements.</div>
            <select id="uiScale">
                <option value="0.75">75%</option>
                <option value="0.875">87.5%</option>
                <option value="1">100% (Default)</option>
                <option value="1.125">112.5%</option>
                <option value="1.25">125%</option>
                <option value="1.5">150%</option>
            </select>
        </div>
    </div>

    <h2>Task Coordination</h2>
    <div class="setting-group">
        <div class="setting-item">
            <label class="setting-label">Coordination Scripts Path</label>
            <div class="setting-description">Path to the coordination scripts directory (containing init-agents.sh, task-claimer.sh)</div>
            <div class="path-input-row">
                <input type="text" id="coordinationScriptsPath" placeholder="Leave empty to use bundled scripts">
                <button class="btn btn-secondary" onclick="browseForPath('coordinationScriptsPath')">Browse...</button>
            </div>
        </div>
        <div class="setting-item">
            <label class="setting-label">Backlog Path</label>
            <div class="setting-description">Path to your task backlog directory. Will be symlinked into .claude-agents/backlog when initializing.</div>
            <div class="path-input-row">
                <input type="text" id="backlogPath" placeholder="e.g., /path/to/BACKLOG">
                <button class="btn btn-secondary" onclick="browseForPath('backlogPath')">Browse...</button>
            </div>
        </div>
    </div>

    <h2>Advanced</h2>
    <div class="setting-group">
        <div class="setting-item">
            <label class="setting-label">Git Diff Polling Interval (ms)</label>
            <div class="setting-description">How often to refresh git diff stats. Set to 0 to disable. Default: 60000 (60 seconds)</div>
            <input type="number" id="diffPollingInterval" min="0" max="300000" value="60000">
        </div>
    </div>

    <div class="actions">
        <button class="btn btn-primary" onclick="saveSettings()">Save Settings</button>
        <button class="btn btn-secondary" onclick="resetToDefaults()">Reset to Defaults</button>
    </div>

    <div class="version-footer">
        Claude Agents v${EXTENSION_VERSION}
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let repositoryPaths = [];
        let repoValidationState = {}; // { path: 'valid' | 'invalid' | 'pending' }

        // Settings schema: id -> { type, default }
        const SETTINGS_SCHEMA = {
            defaultAgentCount: { type: 'number', default: 3 },
            claudeCommand: { type: 'text', default: 'claude' },
            autoStartClaude: { type: 'checkbox', default: false },
            diffPollingInterval: { type: 'number', default: 60000 },
            worktreeDirectory: { type: 'text', default: '.worktrees' },
            coordinationScriptsPath: { type: 'text', default: '' },
            backlogPath: { type: 'text', default: '' },
            terminalType: { type: 'select', default: 'bash' },
            uiScale: { type: 'select', default: 1.0 }
        };

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'settingsLoaded':
                    loadSettings(message.settings);
                    break;
                case 'directorySelected':
                    if (window.pendingRepoIndex !== undefined) {
                        // Update existing repo at index
                        repositoryPaths[window.pendingRepoIndex] = message.path;
                        window.pendingRepoIndex = undefined;
                    } else {
                        // Add new repo
                        if (!repositoryPaths.includes(message.path)) {
                            repositoryPaths.push(message.path);
                        }
                    }
                    validateRepo(repositoryPaths.indexOf(message.path), message.path);
                    break;
                case 'pathSelected':
                    if (message.fieldId) {
                        document.getElementById(message.fieldId).value = message.path;
                    }
                    break;
                case 'repoValidated':
                    repoValidationState[message.path] = message.isValid ? 'valid' : 'invalid';
                    renderRepoList();
                    break;
            }
        });

        function loadSettings(settings) {
            repositoryPaths = settings.repositoryPaths || [];
            repoValidationState = {}; // Reset validation state
            for (const [id, schema] of Object.entries(SETTINGS_SCHEMA)) {
                const el = document.getElementById(id);
                const value = settings[id] ?? schema.default;
                if (schema.type === 'checkbox') {
                    el.checked = value;
                } else {
                    el.value = value;
                }
            }
            renderRepoList();
            // Validate all repos after loading
            validateAllRepos();
        }

        function renderRepoList() {
            const container = document.getElementById('repoList');
            if (repositoryPaths.length === 0) {
                container.innerHTML = '<div class="empty-repos">No repositories configured. Using current workspace.</div>';
                return;
            }

            container.innerHTML = repositoryPaths.map((path, index) => {
                const state = repoValidationState[path] || '';
                const stateClass = state ? state : '';
                const statusIcon = state === 'valid' ? '✓' : state === 'invalid' ? '✗' : state === 'pending' ? '...' : '';
                return \`
                    <div class="repo-item \${stateClass}" data-index="\${index}">
                        <span class="repo-status \${stateClass}">\${statusIcon}</span>
                        <input type="text" value="\${path}"
                            onchange="updateRepo(\${index}, this.value)"
                            onblur="validateRepo(\${index}, this.value)">
                        <button class="btn btn-icon" onclick="browseForRepo(\${index})">...</button>
                        <button class="btn btn-icon btn-danger" onclick="removeRepo(\${index})">×</button>
                    </div>
                \`;
            }).join('');
        }

        function validateRepo(index, path) {
            if (!path || path.trim() === '') {
                delete repoValidationState[path];
                return;
            }
            repoValidationState[path] = 'pending';
            renderRepoList();
            vscode.postMessage({ command: 'validateRepo', path: path, index: index });
        }

        function validateAllRepos() {
            repositoryPaths.forEach((path, index) => {
                if (path && path.trim() !== '') {
                    validateRepo(index, path);
                }
            });
        }

        function addRepo(path) {
            if (path && !repositoryPaths.includes(path)) {
                repositoryPaths.push(path);
                renderRepoList();
            }
        }

        function addEmptyRepo() {
            repositoryPaths.push('');
            renderRepoList();
            // Focus the new input
            const inputs = document.querySelectorAll('.repo-item input');
            if (inputs.length > 0) {
                inputs[inputs.length - 1].focus();
            }
        }

        function updateRepo(index, value) {
            repositoryPaths[index] = value;
        }

        function removeRepo(index) {
            repositoryPaths.splice(index, 1);
            renderRepoList();
        }

        function browseDirectory() {
            vscode.postMessage({ command: 'browseDirectory' });
        }

        function browseForRepo(index) {
            // Store index for when directory is selected
            window.pendingRepoIndex = index;
            vscode.postMessage({ command: 'browseDirectory' });
        }

        function browseForPath(fieldId) {
            window.pendingPathField = fieldId;
            vscode.postMessage({ command: 'browseForPath', fieldId: fieldId });
        }

        function saveSettings() {
            const cleanPaths = repositoryPaths.filter(p => p.trim() !== '');
            const msg = { command: 'saveSettings', repositoryPaths: cleanPaths };

            for (const [id, schema] of Object.entries(SETTINGS_SCHEMA)) {
                const el = document.getElementById(id);
                if (schema.type === 'checkbox') {
                    msg[id] = el.checked;
                } else if (schema.type === 'number') {
                    msg[id] = parseInt(el.value) || schema.default;
                } else {
                    msg[id] = el.value || schema.default;
                }
            }
            vscode.postMessage(msg);
        }

        function resetToDefaults() {
            if (confirm('Reset all settings to defaults?')) {
                const defaults = { repositoryPaths: [] };
                for (const [id, schema] of Object.entries(SETTINGS_SCHEMA)) {
                    defaults[id] = schema.default;
                }
                loadSettings(defaults);
            }
        }

        // Request current settings on load
        vscode.postMessage({ command: 'getSettings' });
    </script>
</body>
</html>`;
    }

    public dispose() {
        SettingsPanel.currentPanel = undefined;
        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
