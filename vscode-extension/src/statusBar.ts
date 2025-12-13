import * as vscode from 'vscode';
import { AgentManager } from './agentManager';
import { formatTimeSince } from './types';
import { getEventBus } from './services';

export class StatusBarManager implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;
    private agentManager: AgentManager;
    private readonly updateHandler = () => this.update();

    constructor(agentManager: AgentManager) {
        this.agentManager = agentManager;

        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );

        this.statusBarItem.command = 'claudeAgents.showApprovals';
        this.update();
        this.statusBarItem.show();

        // Subscribe to events that affect status bar display
        const eventBus = getEventBus();
        eventBus.on('agent:created', this.updateHandler);
        eventBus.on('agent:deleted', this.updateHandler);
        eventBus.on('agent:statusChanged', this.updateHandler);
        eventBus.on('approval:pending', this.updateHandler);
        eventBus.on('approval:resolved', this.updateHandler);
        eventBus.on('status:refreshed', this.updateHandler);
        eventBus.on('diffStats:refreshed', this.updateHandler);
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
        // Unsubscribe from events
        const eventBus = getEventBus();
        eventBus.off('agent:created', this.updateHandler);
        eventBus.off('agent:deleted', this.updateHandler);
        eventBus.off('agent:statusChanged', this.updateHandler);
        eventBus.off('approval:pending', this.updateHandler);
        eventBus.off('approval:resolved', this.updateHandler);
        eventBus.off('status:refreshed', this.updateHandler);
        eventBus.off('diffStats:refreshed', this.updateHandler);

        this.statusBarItem.dispose();
    }
}
