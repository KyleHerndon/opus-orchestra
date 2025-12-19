import * as vscode from 'vscode';
import { AgentManager } from './agentManager';
import { getEventBus } from './services';

export class ApprovalTreeProvider implements vscode.TreeDataProvider<ApprovalTreeItem>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<ApprovalTreeItem | undefined | null | void> =
        new vscode.EventEmitter<ApprovalTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ApprovalTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private readonly refreshHandler = () => this.refresh();

    constructor(private agentManager: AgentManager) {
        // Subscribe to events that affect approvals
        const eventBus = getEventBus();
        eventBus.on('approval:pending', this.refreshHandler);
        eventBus.on('approval:resolved', this.refreshHandler);
        eventBus.on('agent:deleted', this.refreshHandler);
        eventBus.on('status:refreshed', this.refreshHandler);
    }

    dispose(): void {
        const eventBus = getEventBus();
        eventBus.off('approval:pending', this.refreshHandler);
        eventBus.off('approval:resolved', this.refreshHandler);
        eventBus.off('agent:deleted', this.refreshHandler);
        eventBus.off('status:refreshed', this.refreshHandler);
        this._onDidChangeTreeData.dispose();
    }

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
