import * as vscode from 'vscode';
import { AgentManager } from './agentManager';
import { AgentTreeProvider } from './agentTreeView';
import { ApprovalTreeProvider } from './approvalQueue';
import { BacklogTreeProvider } from './backlogTreeView';
import { StatusBarManager } from './statusBar';
import { AgentPanel } from './agentPanel';
import { SettingsPanel } from './settingsPanel';
import { initPersistenceService, getStatusWatcher } from './services';
import { initializeContainer, disposeContainer } from './ServiceContainer';

let agentManager: AgentManager;
let agentTreeProvider: AgentTreeProvider;
let approvalTreeProvider: ApprovalTreeProvider;
let backlogTreeProvider: BacklogTreeProvider;
let statusBarManager: StatusBarManager;

export function activate(context: vscode.ExtensionContext) {
    // Initialize the DI container first - it creates all core services
    const container = initializeContainer(context.extensionPath, context);
    const logger = container.logger;
    const logLevel = container.config.get('logLevel');
    logger.info({ logLevel }, 'Extension activating');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    logger.debug({ workspaceRoot }, 'Workspace root');

    // Initialize persistence service (VSCode-specific, uses vscode.ExtensionContext)
    const persistenceService = initPersistenceService(workspaceRoot);
    persistenceService.setContext(context);

    // Initialize managers
    agentManager = new AgentManager(context.extensionPath);
    agentManager.setContext(context);  // Enable persistence
    agentTreeProvider = new AgentTreeProvider(agentManager);
    approvalTreeProvider = new ApprovalTreeProvider(agentManager);
    backlogTreeProvider = new BacklogTreeProvider();
    statusBarManager = new StatusBarManager(agentManager);

    // Register tree views
    const agentTreeView = vscode.window.createTreeView('agentList', {
        treeDataProvider: agentTreeProvider,
        showCollapseAll: false
    });

    const backlogTreeView = vscode.window.createTreeView('backlogList', {
        treeDataProvider: backlogTreeProvider,
        showCollapseAll: false
    });

    const approvalTreeView = vscode.window.createTreeView('approvalQueue', {
        treeDataProvider: approvalTreeProvider,
        showCollapseAll: false
    });

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('claudeAgents.createAgents', async () => {
            const config = vscode.workspace.getConfiguration('claudeAgents');
            const defaultCount = config.get<number>('defaultAgentCount', 3);

            const countStr = await vscode.window.showInputBox({
                prompt: 'Number of agents to create',
                value: defaultCount.toString(),
                validateInput: (v) => {
                    const n = parseInt(v);
                    if (isNaN(n) || n < 1 || n > 10) {
                        return 'Enter a number between 1 and 10';
                    }
                    return null;
                }
            });

            if (countStr) {
                const count = parseInt(countStr);
                await agentManager.createAgents(count);
                // Note: EventBus 'agent:created' handles refresh
            }
        }),

        vscode.commands.registerCommand('claudeAgents.switchToAgent', async () => {
            const agents = agentManager.getAgents();
            if (agents.length === 0) {
                vscode.window.showWarningMessage('No agents created. Run "Create Agent Worktrees" first.');
                return;
            }

            const items = agents.map(a => ({
                label: `$(${a.statusIcon}) Agent ${a.id}`,
                description: a.status,
                detail: a.branch,
                agentId: a.id
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select an agent to switch to'
            });

            if (selected) {
                agentManager.focusAgent(selected.agentId);
            }
        }),

        vscode.commands.registerCommand('claudeAgents.showApprovals', () => {
            vscode.commands.executeCommand('approvalQueue.focus');
        }),

        vscode.commands.registerCommand('claudeAgents.refreshAgents', () => {
            agentManager.refreshStatus();
            agentTreeProvider.refresh();
            approvalTreeProvider.refresh();
        }),

        vscode.commands.registerCommand('claudeAgents.refreshBacklog', () => {
            backlogTreeProvider.refresh();
        }),

        vscode.commands.registerCommand('claudeAgents.startAgent', async (item: { agentId?: number }) => {
            if (item && item.agentId) {
                await agentManager.startClaudeInAgent(item.agentId);
            }
        }),

        vscode.commands.registerCommand('claudeAgents.approveAction', (item: { agentId?: number }) => {
            if (item && item.agentId) {
                agentManager.sendToAgent(item.agentId, 'y');
                // Note: EventBus 'approval:resolved' handles refresh
            }
        }),

        vscode.commands.registerCommand('claudeAgents.rejectAction', (item: { agentId?: number }) => {
            if (item && item.agentId) {
                agentManager.sendToAgent(item.agentId, 'n');
                // Note: EventBus 'approval:resolved' handles refresh
            }
        }),

        vscode.commands.registerCommand('claudeAgents.cleanup', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'This will close all agent terminals and remove worktrees. Continue?',
                'Yes', 'No'
            );
            if (confirm === 'Yes') {
                await agentManager.cleanup();
                agentTreeProvider.refresh();
                approvalTreeProvider.refresh();
            }
        }),

        // Click on agent in tree view
        vscode.commands.registerCommand('claudeAgents.selectAgent', (agentId: number) => {
            agentManager.focusAgent(agentId);
        }),

        // Open fullscreen dashboard
        vscode.commands.registerCommand('claudeAgents.openDashboard', () => {
            AgentPanel.show(agentManager);
        }),

        // Initialize project for Claude Agents
        vscode.commands.registerCommand('claudeAgents.initProject', async () => {
            const result = await agentManager.initializeProject();
            if (result.success) {
                vscode.window.showInformationMessage(result.message);
                agentTreeProvider.refresh();
            } else {
                vscode.window.showErrorMessage(result.message);
            }
        }),

        // Open settings panel
        vscode.commands.registerCommand('claudeAgents.openSettings', () => {
            SettingsPanel.show(context.extensionUri);
        }),

        // Create agent for a specific task
        vscode.commands.registerCommand('claudeAgents.createAgentForTask', async () => {
            const repoPaths = agentManager.getRepositoryPaths();
            if (repoPaths.length === 0) {
                vscode.window.showWarningMessage('No repository paths configured');
                return;
            }

            // Pick repository first if multiple
            let targetRepo = repoPaths[0];
            if (repoPaths.length > 1) {
                const picked = await vscode.window.showQuickPick(
                    repoPaths.map(p => ({ label: p.split('/').pop() || p, description: p, path: p })),
                    { placeHolder: 'Select repository' }
                );
                if (!picked) {
                    return;
                }
                targetRepo = picked.path;
            }

            const tasks = agentManager.getAvailableTasks(targetRepo);
            if (tasks.length === 0) {
                vscode.window.showWarningMessage('No available tasks in backlog. Add task files to .opus-orchestra/backlog/');
                return;
            }

            const items = tasks.map(task => ({
                label: task,
                description: `${task}.md`
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a task to create an agent for'
            });

            if (selected) {
                await agentManager.createAgentForTask(selected.label, targetRepo);
                // Note: EventBus 'agent:created' handles refresh
            }
        }),

        // Initialize coordination in a repository
        vscode.commands.registerCommand('claudeAgents.initCoordination', async () => {
            const repoPaths = agentManager.getRepositoryPaths();
            if (repoPaths.length === 0) {
                vscode.window.showWarningMessage('No repository paths configured');
                return;
            }

            // Pick repository if multiple
            let targetRepo = repoPaths[0];
            if (repoPaths.length > 1) {
                const picked = await vscode.window.showQuickPick(
                    repoPaths.map(p => ({ label: p.split('/').pop() || p, description: p, path: p })),
                    { placeHolder: 'Select repository to initialize' }
                );
                if (!picked) {
                    return;
                }
                targetRepo = picked.path;
            }

            const config = vscode.workspace.getConfiguration('claudeAgents');
            const backlogPath = config.get<string>('backlogPath', '');

            const result = await agentManager.initializeCoordination(targetRepo, backlogPath || undefined);
            if (result.success) {
                vscode.window.showInformationMessage(result.message);
            } else {
                vscode.window.showErrorMessage(result.message);
            }
        }),

        // Cleanup completed tasks
        vscode.commands.registerCommand('claudeAgents.cleanupCompleted', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'This will remove all completed task files. Continue?',
                'Yes', 'No'
            );
            if (confirm === 'Yes') {
                const result = await agentManager.cleanupCompletedTasks();
                if (result.success) {
                    vscode.window.showInformationMessage(`Cleaned up ${result.count} completed task(s)`);
                } else {
                    vscode.window.showErrorMessage('Failed to cleanup completed tasks');
                }
            }
        }),

        // Check available container configs
        vscode.commands.registerCommand('claudeAgents.checkIsolation', async () => {
            const repoPaths = agentManager.getRepositoryPaths();
            if (repoPaths.length === 0) {
                vscode.window.showWarningMessage('No repository paths configured');
                return;
            }

            // Get available configs from all repos
            const allConfigs: Array<{name: string, repoPath: string}> = [];
            for (const repoPath of repoPaths) {
                const configs = agentManager.getAvailableContainerConfigs(repoPath);
                for (const configName of configs) {
                    if (!allConfigs.some(c => c.name === configName)) {
                        allConfigs.push({ name: configName, repoPath });
                    }
                }
            }

            const items = allConfigs.map(config => ({
                label: config.name,
                description: config.name.startsWith('repo:') ? '(repository config)' :
                             config.name.startsWith('user:') ? '(user config)' :
                             config.name === 'unisolated' ? '(no isolation)' : '',
                configName: config.name
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Available container configurations',
                title: 'Container Configurations'
            });

            if (selected) {
                vscode.window.showInformationMessage(`Selected config: ${selected.configName}`);
            }
        }),

        // Run setup script
        vscode.commands.registerCommand('claudeAgents.runSetup', async () => {
            const terminal = vscode.window.createTerminal({
                name: 'Opus Orchestra Setup',
                cwd: context.extensionPath
            });
            terminal.show();

            // Detect platform and run appropriate script
            if (process.platform === 'win32') {
                terminal.sendText('powershell -ExecutionPolicy Bypass -File scripts/setup.ps1');
            } else {
                terminal.sendText('./scripts/setup.sh');
            }
        })
    );

    // Listen for terminal close events via the TerminalAdapter
    // This ensures we receive TerminalHandle (not vscode.Terminal) for type compatibility
    const terminalAdapter = container.terminal;
    const unsubscribeTerminalClose = terminalAdapter.onDidClose((handle) => {
        agentManager.handleTerminalClosed(handle);
        // EventBus 'agent:terminalClosed' will trigger component updates
    });
    context.subscriptions.push({ dispose: unsubscribeTerminalClose });

    // Start the centralized status watcher
    // This polls status files and emits EventBus events
    // All UI components subscribe to events and update themselves
    const statusWatcher = getStatusWatcher();
    statusWatcher.start(agentManager);

    context.subscriptions.push({
        dispose: () => statusWatcher.stop()
    });

    // Register disposables
    context.subscriptions.push(
        agentTreeView,
        backlogTreeView,
        approvalTreeView,
        agentTreeProvider,
        approvalTreeProvider,
        statusBarManager
    );
}

export function deactivate() {
    // Cleanup is handled by disposables
    disposeContainer();
}
