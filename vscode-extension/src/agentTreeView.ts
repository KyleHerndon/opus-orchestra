import * as vscode from 'vscode';
import { AgentManager, Agent } from './agentManager';
import { formatTimeSince } from './types';

export class AgentTreeProvider implements vscode.TreeDataProvider<AgentTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<AgentTreeItem | undefined | null | void> =
        new vscode.EventEmitter<AgentTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<AgentTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    constructor(private agentManager: AgentManager) {}

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
            (this as any).agentId = agent.id;
        }
    }
}
