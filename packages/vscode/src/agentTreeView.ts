import * as vscode from 'vscode';
import { AgentManager, Agent } from './agentManager';
import { formatTimeSince } from './types';
import { getEventBus } from './services';

export class AgentTreeProvider implements vscode.TreeDataProvider<AgentTreeItem>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<AgentTreeItem | undefined | null | void> =
        new vscode.EventEmitter<AgentTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<AgentTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private readonly refreshHandler = () => this.refresh();

    constructor(private agentManager: AgentManager) {
        // Subscribe to events that should trigger a refresh
        const eventBus = getEventBus();
        eventBus.on('agent:created', this.refreshHandler);
        eventBus.on('agent:deleted', this.refreshHandler);
        eventBus.on('agent:renamed', this.refreshHandler);
        eventBus.on('agent:terminalClosed', this.refreshHandler);
        eventBus.on('agent:statusChanged', this.refreshHandler);
        eventBus.on('status:refreshed', this.refreshHandler);
        eventBus.on('diffStats:refreshed', this.refreshHandler);
    }

    dispose(): void {
        const eventBus = getEventBus();
        eventBus.off('agent:created', this.refreshHandler);
        eventBus.off('agent:deleted', this.refreshHandler);
        eventBus.off('agent:renamed', this.refreshHandler);
        eventBus.off('agent:terminalClosed', this.refreshHandler);
        eventBus.off('agent:statusChanged', this.refreshHandler);
        eventBus.off('status:refreshed', this.refreshHandler);
        eventBus.off('diffStats:refreshed', this.refreshHandler);
        this._onDidChangeTreeData.dispose();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: AgentTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: AgentTreeItem): Thenable<AgentTreeItem[]> {
        if (element) {
            // No children for now
            return Promise.resolve([]);
        }

        const agents = this.agentManager.getAgents();

        if (agents.length === 0) {
            // Show "no agents" message
            const noAgentsItem = new AgentTreeItem(
                'No agents created',
                'Run "Create Agent Worktrees" to start',
                vscode.TreeItemCollapsibleState.None
            );
            noAgentsItem.iconPath = new vscode.ThemeIcon('info');
            return Promise.resolve([noAgentsItem]);
        }

        const items = agents.map(agent => {
            const label = agent.name || `Agent ${agent.id}`;
            const item = new AgentTreeItem(
                label,
                this.getStatusDescription(agent),
                vscode.TreeItemCollapsibleState.None,
                agent
            );

            item.iconPath = new vscode.ThemeIcon(agent.statusIcon);
            item.contextValue = 'agent';
            item.tooltip = this.getTooltip(agent);

            // Click to focus terminal
            item.command = {
                command: 'claudeAgents.selectAgent',
                title: 'Select Agent',
                arguments: [agent.id]
            };

            return item;
        });

        return Promise.resolve(items);
    }

    private getStatusDescription(agent: Agent): string {
        const timeStr = formatTimeSince(agent.lastInteractionTime);
        const diffStr = this.formatDiffStats(agent);

        switch (agent.status) {
            case 'working':
                return `Working ${timeStr} ${diffStr}`;
            case 'waiting-input':
                return `⚡ Waiting ${timeStr} ${diffStr}`;
            case 'waiting-approval':
                return `❓ Needs approval ${timeStr} ${diffStr}`;
            case 'error':
                return `Error ${timeStr} ${diffStr}`;
            default:
                return `Idle ${timeStr} ${diffStr}`;
        }
    }

    private formatDiffStats(agent: Agent): string {
        const { insertions, deletions } = agent.diffStats;
        if (insertions === 0 && deletions === 0) {
            return '';
        }
        return `+${insertions}/-${deletions}`;
    }

    private getTooltip(agent: Agent): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        const name = agent.name || `Agent ${agent.id}`;
        md.appendMarkdown(`**${name}** - ${agent.branch}\n\n`);
        if (agent.taskFile) {
            md.appendMarkdown(`**Task:** ${agent.taskFile}\n\n`);
        }
        md.appendMarkdown(`**Status:** ${agent.status}\n\n`);
        md.appendMarkdown(`**Last interaction:** ${agent.lastInteractionTime.toLocaleTimeString()}\n\n`);

        const { insertions, deletions, filesChanged } = agent.diffStats;
        if (filesChanged > 0) {
            md.appendMarkdown(`**Changes:** ${filesChanged} file${filesChanged > 1 ? 's' : ''}\n\n`);
            md.appendMarkdown(`- Insertions: +${insertions}\n`);
            md.appendMarkdown(`- Deletions: -${deletions}\n`);
        } else {
            md.appendMarkdown(`**Changes:** No changes yet\n`);
        }

        md.appendMarkdown(`\n---\n*Click to focus terminal*`);
        return md;
    }
}

export class AgentTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly agent?: Agent
    ) {
        super(label, collapsibleState);
        this.tooltip = this.description;

        if (agent) {
            (this as unknown as { agentId: number }).agentId = agent.id;
        }
    }
}
