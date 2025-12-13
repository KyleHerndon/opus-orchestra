import * as vscode from 'vscode';
import { AgentManager } from './agentManager';

export class ApprovalTreeProvider implements vscode.TreeDataProvider<ApprovalTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ApprovalTreeItem | undefined | null | void> =
        new vscode.EventEmitter<ApprovalTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ApprovalTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    constructor(private agentManager: AgentManager) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ApprovalTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ApprovalTreeItem): Thenable<ApprovalTreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        const approvals = this.agentManager.getPendingApprovals();

        if (approvals.length === 0) {
            const noApprovalsItem = new ApprovalTreeItem(
                'No pending approvals',
                'All agents are working or idle',
                vscode.TreeItemCollapsibleState.None
            );
            noApprovalsItem.iconPath = new vscode.ThemeIcon('check');
            return Promise.resolve([noApprovalsItem]);
        }

        const items = approvals.map(approval => {
            const item = new ApprovalTreeItem(
                `Agent ${approval.agentId}`,
                approval.description,
                vscode.TreeItemCollapsibleState.None,
                approval.agentId
            );

            item.iconPath = new vscode.ThemeIcon('question');
            item.contextValue = 'approval';

            // Click to focus the agent's terminal
            item.command = {
                command: 'claudeAgents.selectAgent',
                title: 'Focus Agent',
                arguments: [approval.agentId]
            };

            return item;
        });

        return Promise.resolve(items);
    }
}

export class ApprovalTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly agentId?: number
    ) {
        super(label, collapsibleState);
        this.tooltip = this.description;
    }
}
