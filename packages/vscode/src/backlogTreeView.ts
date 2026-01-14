import * as vscode from 'vscode';
import * as fs from 'fs';
import { agentPath } from './pathUtils';

export class BacklogTreeProvider implements vscode.TreeDataProvider<BacklogItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<BacklogItem | undefined | null | void> =
        new vscode.EventEmitter<BacklogItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<BacklogItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private backlogPath: string = '';

    constructor() {
        this.updateBacklogPath();
    }

    refresh(): void {
        this.updateBacklogPath();
        this._onDidChangeTreeData.fire();
    }

    private updateBacklogPath(): void {
        const config = vscode.workspace.getConfiguration('claudeAgents');
        const configuredPath = config.get<string>('backlogPath', '');

        if (configuredPath) {
            this.backlogPath = configuredPath;
        } else {
            // Try to find backlog in workspace
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (workspaceRoot) {
                const defaultPath = agentPath(workspaceRoot).join('.opus-orchestra', 'backlog').forNodeFs();
                if (fs.existsSync(defaultPath)) {
                    this.backlogPath = defaultPath;
                }
            }
        }
    }

    getTreeItem(element: BacklogItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: BacklogItem): Thenable<BacklogItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        if (!this.backlogPath || !fs.existsSync(this.backlogPath)) {
            const noBacklogItem = new BacklogItem(
                'No backlog configured',
                'Set claudeAgents.backlogPath in settings',
                vscode.TreeItemCollapsibleState.None
            );
            noBacklogItem.iconPath = new vscode.ThemeIcon('info');
            return Promise.resolve([noBacklogItem]);
        }

        try {
            const files = fs.readdirSync(this.backlogPath);
            const taskFiles = files.filter(f => f.endsWith('.md'));

            if (taskFiles.length === 0) {
                const emptyItem = new BacklogItem(
                    'No tasks in backlog',
                    'Add .md files to your backlog directory',
                    vscode.TreeItemCollapsibleState.None
                );
                emptyItem.iconPath = new vscode.ThemeIcon('inbox');
                return Promise.resolve([emptyItem]);
            }

            const items = taskFiles.map(file => {
                const taskName = file.replace('.md', '');
                const filePath = agentPath(this.backlogPath).join(file).forNodeFs();
                const item = new BacklogItem(
                    taskName,
                    '',
                    vscode.TreeItemCollapsibleState.None,
                    filePath
                );

                item.iconPath = new vscode.ThemeIcon('file-text');
                item.contextValue = 'backlogTask';

                // Click to open the file
                item.command = {
                    command: 'vscode.open',
                    title: 'Open Task File',
                    arguments: [vscode.Uri.file(filePath)]
                };

                return item;
            });

            return Promise.resolve(items);
        } catch (error) {
            const errorItem = new BacklogItem(
                'Error reading backlog',
                String(error),
                vscode.TreeItemCollapsibleState.None
            );
            errorItem.iconPath = new vscode.ThemeIcon('error');
            return Promise.resolve([errorItem]);
        }
    }
}

export class BacklogItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly filePath?: string
    ) {
        super(label, collapsibleState);
        this.tooltip = filePath || this.description;
    }
}
