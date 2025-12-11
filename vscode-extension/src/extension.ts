import * as vscode from 'vscode';
import { AgentManager } from './agentManager';
import { AgentTreeProvider } from './agentTreeView';
import { ApprovalTreeProvider } from './approvalQueue';
import { BacklogTreeProvider } from './backlogTreeView';
import { StatusBarManager } from './statusBar';
import { AgentPanel } from './agentPanel';
import { SettingsPanel } from './settingsPanel';
import { initLogger, initPersistenceService } from './services';

let agentManager: AgentManager;
let agentTreeProvider: AgentTreeProvider;
let approvalTreeProvider: ApprovalTreeProvider;
let backlogTreeProvider: BacklogTreeProvider;
let statusBarManager: StatusBarManager;

export function activate(context: vscode.ExtensionContext) {
    // Initialize services
    initLogger(context.extensionPath);
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
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
                agentTreeProvider.refresh();
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

        vscode.commands.registerCommand('claudeAgents.startAgent', async (item: any) => {
            if (item && item.agentId) {
                await agentManager.startClaudeInAgent(item.agentId);
            }
        }),

        vscode.commands.registerCommand('claudeAgents.approveAction', (item: any) => {
            if (item && item.agentId) {
                agentManager.sendToAgent(item.agentId, 'y');
                approvalTreeProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('claudeAgents.rejectAction', (item: any) => {
            if (item && item.agentId) {
                agentManager.sendToAgent(item.agentId, 'n');
                approvalTreeProvider.refresh();
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
                vscode.window.showWarningMessage('No available tasks in backlog. Add task files to .claude-agents/backlog/');
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
                const agent = await agentManager.createAgentForTask(selected.label, targetRepo);
                if (agent) {
                    agentTreeProvider.refresh();
                }
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

        // Check available isolation tiers
        vscode.commands.registerCommand('claudeAgents.checkIsolation', async () => {
            const tiers = await agentManager.getAvailableIsolationTiers();
            const config = vscode.workspace.getConfiguration('claudeAgents');
            const currentTier = config.get<string>('isolationTier', 'standard');

            const tierDescriptions: Record<string, string> = {
                'standard': 'No isolation - manual approval for all operations',
                'sandbox': 'Lightweight OS-level isolation (bubblewrap/sandbox-exec)',
                'docker': 'Container isolation with hardened security options',
                'gvisor': 'Kernel-level isolation via userspace syscall interception',
                'firecracker': 'Full VM isolation with dedicated kernel'
            };

            const items = tiers.map(tier => ({
                label: `$(${tier === currentTier ? 'check' : 'circle-outline'}) ${tier}`,
                description: tier === currentTier ? '(current)' : '',
                detail: tierDescriptions[tier] || tier,
                tier
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Available isolation tiers (current: ${currentTier})`,
                title: 'Isolation Tiers'
            });

            if (selected && selected.tier !== currentTier) {
                await config.update('isolationTier', selected.tier, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`Isolation tier set to: ${selected.tier}`);
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

    // Listen for terminal close events
    context.subscriptions.push(
        vscode.window.onDidCloseTerminal((terminal) => {
            agentManager.handleTerminalClosed(terminal);
            agentTreeProvider.refresh();
        })
    );

    // Start status polling (lightweight - no git commands)
    const pollingInterval = vscode.workspace.getConfiguration('claudeAgents')
        .get<number>('statusPollingInterval', 1000);

    const statusPoller = setInterval(() => {
        agentManager.refreshStatus();
        agentTreeProvider.refresh();
        approvalTreeProvider.refresh();
        statusBarManager.update();
    }, pollingInterval);

    // Start separate diff stats polling (heavier - runs git commands async)
    const diffPollingInterval = vscode.workspace.getConfiguration('claudeAgents')
        .get<number>('diffPollingInterval', 60000);

    let diffPoller: NodeJS.Timeout | undefined;
    if (diffPollingInterval > 0) {
        // Initial diff refresh
        agentManager.refreshDiffStats();

        diffPoller = setInterval(() => {
            agentManager.refreshDiffStats();
        }, diffPollingInterval);
    }

    context.subscriptions.push({
        dispose: () => {
            clearInterval(statusPoller);
            if (diffPoller) {
                clearInterval(diffPoller);
            }
        }
    });

    // Register disposables
    context.subscriptions.push(
        agentTreeView,
        backlogTreeView,
        approvalTreeView,
        statusBarManager
    );
}

export function deactivate() {
    // Cleanup is handled by disposables
}
