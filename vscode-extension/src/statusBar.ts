import * as vscode from 'vscode';
import { AgentManager } from './agentManager';
import { formatTimeSince } from './types';

export class StatusBarManager implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;
    private agentManager: AgentManager;

    constructor(agentManager: AgentManager) {
        this.agentManager = agentManager;

        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );

        this.statusBarItem.command = 'claudeAgents.showApprovals';
        this.update();
        this.statusBarItem.show();
    }

    update(): void {
        const agents = this.agentManager.getAgents();
        const waitingCount = this.agentManager.getWaitingCount();
        const totalAgents = agents.length;

        if (totalAgents === 0) {
            this.statusBarItem.text = '$(hubot) No agents';
            this.statusBarItem.tooltip = 'Click to view approval queue';
            this.statusBarItem.backgroundColor = undefined;
            return;
        }

        // Aggregate diff stats
        const totalInsertions = agents.reduce((sum, a) => sum + a.diffStats.insertions, 0);
        const totalDeletions = agents.reduce((sum, a) => sum + a.diffStats.deletions, 0);
        const diffStr = (totalInsertions > 0 || totalDeletions > 0)
            ? ` +${totalInsertions}/-${totalDeletions}`
            : '';

        if (waitingCount > 0) {
            this.statusBarItem.text = `$(bell) ${waitingCount} waiting${diffStr}`;
            this.statusBarItem.tooltip = this.buildTooltip(agents, waitingCount);
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            const workingCount = agents.filter(a => a.status === 'working').length;
            this.statusBarItem.text = `$(hubot) ${workingCount}/${totalAgents}${diffStr}`;
            this.statusBarItem.tooltip = this.buildTooltip(agents, waitingCount);
            this.statusBarItem.backgroundColor = undefined;
        }
    }

    private buildTooltip(agents: ReturnType<AgentManager['getAgents']>, waitingCount: number): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**Claude Agents**\n\n`);

        if (waitingCount > 0) {
            md.appendMarkdown(`⚠️ ${waitingCount} agent(s) need attention\n\n`);
        }

        md.appendMarkdown(`| Agent | Status | Time | Changes |\n`);
        md.appendMarkdown(`|-------|--------|------|--------|\n`);

        for (const agent of agents) {
            const timeStr = formatTimeSince(agent.lastInteractionTime);
            const diffStr = agent.diffStats.insertions > 0 || agent.diffStats.deletions > 0
                ? `+${agent.diffStats.insertions}/-${agent.diffStats.deletions}`
                : '-';
            md.appendMarkdown(`| ${agent.id} | ${agent.status} | ${timeStr} | ${diffStr} |\n`);
        }

        md.appendMarkdown(`\n*Click to view approval queue*`);
        return md;
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}
