import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { agentPath } from './pathUtils';
import { ContainerManager } from './containerManager';
import { WorktreeManager, AgentStatusTracker, AgentPersistence } from './managers';

import {
    Agent,
    AgentStatus,
    PersistedAgent,
    DiffStats,
    PendingApproval,
    IsolationTier,
    ContainerInfo,
    AGENT_NAMES,
} from './types';

import {
    getConfigService,
    getCommandService,
    getGitService,
    getTerminalService,
    getEventBus,
    getLogger,
    isLoggerInitialized,
    getTerminalIcon,
} from './services';

// Re-export types for backward compatibility
export { Agent, AgentStatus, PersistedAgent, DiffStats, PendingApproval, IsolationTier, ContainerInfo };

/**
 * Coordinates agent lifecycle and delegates to specialized managers.
 */
export class AgentManager {
    private agents: Map<number, Agent> = new Map();
    private workspaceRoot: string;
    private extensionPath: string;

    // Specialized managers
    private containerManager: ContainerManager;
    private worktreeManager: WorktreeManager;
    private statusTracker: AgentStatusTracker;
    private persistence: AgentPersistence;

    constructor(extensionPath: string) {
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        this.extensionPath = extensionPath;

        // Initialize managers
        this.containerManager = new ContainerManager(extensionPath);
        this.worktreeManager = new WorktreeManager(extensionPath);
        this.statusTracker = new AgentStatusTracker();
        this.persistence = new AgentPersistence(this.worktreeManager, this.containerManager);
    }

    private get worktreeDir(): string {
        return getConfigService().worktreeDirectory;
    }

    setContext(context: vscode.ExtensionContext): void {
        this.containerManager.setContext(context);
        this.agents = this.persistence.restoreAgents(this.getRepositoryPaths());
    }

    getContainerManager(): ContainerManager {
        return this.containerManager;
    }

    async getAvailableIsolationTiers(): Promise<IsolationTier[]> {
        return this.containerManager.getAvailableTiers();
    }

    private debugLog(message: string): void {
        if (isLoggerInitialized()) {
            getLogger().child('AgentManager').debug(message);
        }
    }

    private getAgentName(id: number): string {
        if (id <= AGENT_NAMES.length) {
            return AGENT_NAMES[id - 1];
        }
        const baseIndex = (id - 1) % AGENT_NAMES.length;
        const suffix = Math.floor((id - 1) / AGENT_NAMES.length) + 1;
        return `${AGENT_NAMES[baseIndex]}-${suffix}`;
    }

    private toTerminalPath(inputPath: string): string {
        return agentPath(inputPath).forTerminal();
    }

    private toWindowsPath(inputPath: string): string {
        return agentPath(inputPath).forNodeFs();
    }

    private execCommand(command: string, cwd: string): string {
        return getCommandService().exec(command, cwd);
    }

    private execCommandSilent(command: string, cwd: string): void {
        getCommandService().execSilent(command, cwd);
    }

    getRepositoryPaths(): string[] {
        const configuredPaths = getConfigService().repositoryPaths;
        if (configuredPaths.length > 0) {
            return configuredPaths;
        }
        return this.workspaceRoot ? [this.workspaceRoot] : [];
    }

    // ========================================================================
    // Agent Lifecycle
    // ========================================================================

    async createAgents(count: number, repoPath?: string, isolationTier?: IsolationTier): Promise<void> {
        const repoPaths = this.getRepositoryPaths();

        if (repoPaths.length === 0) {
            vscode.window.showErrorMessage('No repository paths configured and no workspace folder open');
            return;
        }

        let targetRepo = repoPath;
        if (!targetRepo) {
            if (repoPaths.length === 1) {
                targetRepo = repoPaths[0];
            } else {
                const picked = await vscode.window.showQuickPick(
                    repoPaths.map(p => ({ label: path.basename(p), description: p, path: p })),
                    { placeHolder: 'Select repository to create agents in' }
                );
                if (!picked) {
                    return;
                }
                targetRepo = picked.path;
            }
        }

        try {
            this.execCommand('git rev-parse --git-dir', targetRepo);
        } catch {
            vscode.window.showErrorMessage(`Not a git repository: ${targetRepo}`);
            return;
        }

        const defaultTier = isolationTier || getConfigService().isolationTier;
        const repoConfig = this.containerManager.loadRepoConfig(targetRepo);
        const availableTiers = await this.containerManager.getAvailableTiers();

        if (!availableTiers.includes(defaultTier)) {
            const fallback = availableTiers[availableTiers.length - 1];
            const useAlternative = await vscode.window.showWarningMessage(
                `Isolation tier '${defaultTier}' is not available. Use '${fallback}' instead?`,
                'Yes', 'No'
            );
            if (useAlternative !== 'Yes') {
                return;
            }
        }

        const baseBranch = this.execCommand('git branch --show-current', targetRepo).trim();

        const existingIds = new Set<number>();
        for (const agent of this.agents.values()) {
            if (agent.repoPath === targetRepo) {
                existingIds.add(agent.id);
            }
        }

        let createdCount = 0;
        let restoredCount = 0;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Creating agent worktrees',
            cancellable: false
        }, async (progress) => {
            let nextId = 1;
            while (createdCount + restoredCount < count) {
                while (existingIds.has(nextId)) {
                    nextId++;
                }

                const agentName = this.getAgentName(nextId);
                progress.report({ message: `Creating agent ${agentName}...`, increment: (100 / count) });

                const branchName = `claude-${agentName}`;
                const worktreePath = this.worktreeManager.getWorktreePath(targetRepo, agentName);

                try {
                    if (this.worktreeManager.worktreeExists(worktreePath)) {
                        const existingMetadata = this.worktreeManager.loadAgentMetadata(worktreePath);

                        if (existingMetadata) {
                            this.debugLog(`Restoring existing agent from worktree: ${agentName}`);

                            const agent: Agent = {
                                id: existingMetadata.id || nextId,
                                name: existingMetadata.name || agentName,
                                sessionId: existingMetadata.sessionId || this.persistence.generateSessionId(),
                                branch: existingMetadata.branch || branchName,
                                worktreePath,
                                repoPath: targetRepo,
                                taskFile: existingMetadata.taskFile || null,
                                terminal: null,
                                status: 'idle',
                                statusIcon: 'circle-outline',
                                pendingApproval: null,
                                lastInteractionTime: new Date(),
                                diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
                                isolationTier: existingMetadata.isolationTier || defaultTier,
                                sessionStarted: existingMetadata.sessionStarted,
                            };

                            this.agents.set(agent.id, agent);
                            existingIds.add(agent.id);
                            restoredCount++;

                            this.createTerminalForAgent(agent, agent.sessionStarted);
                            getEventBus().emit('agent:created', { agent });

                            nextId++;
                            continue;
                        }
                    } else {
                        this.worktreeManager.createWorktree(targetRepo, worktreePath, branchName, baseBranch);
                    }

                    const agent: Agent = {
                        id: nextId,
                        name: agentName,
                        sessionId: this.persistence.generateSessionId(),
                        branch: branchName,
                        worktreePath,
                        repoPath: targetRepo,
                        taskFile: null,
                        terminal: null,
                        status: 'idle',
                        statusIcon: 'circle-outline',
                        pendingApproval: null,
                        lastInteractionTime: new Date(),
                        diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
                        isolationTier: defaultTier
                    };

                    this.agents.set(nextId, agent);
                    existingIds.add(nextId);
                    createdCount++;

                    this.worktreeManager.copyCoordinationFiles(agent);
                    this.worktreeManager.saveAgentMetadata(agent);

                    if (defaultTier !== 'standard') {
                        try {
                            const containerInfo = await this.containerManager.createContainer(
                                nextId,
                                worktreePath,
                                defaultTier,
                                repoConfig
                            );
                            agent.containerInfo = containerInfo;
                        } catch (containerError) {
                            vscode.window.showWarningMessage(
                                `Failed to create container for agent ${agentName}: ${containerError}. Running in standard mode.`
                            );
                            agent.isolationTier = 'standard';
                        }
                    }

                    this.createTerminalForAgent(agent);
                    getEventBus().emit('agent:created', { agent });

                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to create agent ${nextId}: ${error}`);
                }

                nextId++;
            }
        });

        this.persistence.saveAgents(this.agents);

        const tierInfo = defaultTier !== 'standard' ? ` (${defaultTier} isolation)` : '';
        const message = restoredCount > 0
            ? `Created ${createdCount} new, restored ${restoredCount} existing agent worktrees${tierInfo}`
            : `Created ${createdCount} agent worktrees${tierInfo}`;
        vscode.window.showInformationMessage(message);
    }

    async deleteAgent(agentId: number): Promise<boolean> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            return false;
        }

        if (agent.terminal) {
            agent.terminal.dispose();
        }

        if (agent.containerInfo) {
            await this.containerManager.removeContainer(agentId);
        }

        try {
            this.worktreeManager.removeWorktree(agent.repoPath, agent.worktreePath, agent.branch);
        } catch {
            // Ignore errors during cleanup
        }

        this.agents.delete(agentId);
        this.persistence.saveAgents(this.agents);
        getEventBus().emit('agent:deleted', { agentId });
        vscode.window.showInformationMessage(`Agent ${agent.name || agentId} deleted`);
        return true;
    }

    async renameAgent(agentId: number, newName: string): Promise<boolean> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            return false;
        }

        const sanitizedName = newName.trim()
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        if (!sanitizedName) {
            vscode.window.showErrorMessage('Invalid agent name');
            return false;
        }

        for (const a of this.agents.values()) {
            if (a.id !== agentId && a.name === sanitizedName) {
                vscode.window.showErrorMessage(`Agent name "${sanitizedName}" already exists`);
                return false;
            }
        }

        const oldBranch = agent.branch;
        const newBranch = `claude-${sanitizedName}`;
        const newWorktreePath = this.worktreeManager.getWorktreePath(agent.repoPath, sanitizedName);
        const previousName = agent.name;

        try {
            if (agent.terminal) {
                agent.terminal.dispose();
                agent.terminal = null;
            }

            this.worktreeManager.renameWorktree(
                agent.repoPath,
                agent.worktreePath,
                newWorktreePath,
                oldBranch,
                newBranch
            );

            agent.name = sanitizedName;
            agent.branch = newBranch;
            agent.worktreePath = newWorktreePath;

            this.worktreeManager.copyCoordinationFiles(agent);
            this.persistence.saveAgents(this.agents);

            getEventBus().emit('agent:renamed', { agent, previousName });
            vscode.window.showInformationMessage(`Agent renamed to "${sanitizedName}"`);
            return true;
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to rename agent: ${error}`);
            return false;
        }
    }

    async cleanup(): Promise<void> {
        for (const agent of this.agents.values()) {
            if (agent.terminal) {
                agent.terminal.dispose();
            }
            if (agent.containerInfo) {
                await this.containerManager.removeContainer(agent.id);
            }
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Cleaning up worktrees',
            cancellable: false
        }, async (progress) => {
            for (const agent of this.agents.values()) {
                progress.report({ message: `Removing agent ${agent.id}...` });
                this.worktreeManager.removeWorktree(agent.repoPath, agent.worktreePath, agent.branch);
            }
        });

        this.agents.clear();
        this.persistence.saveAgents(this.agents);
        vscode.window.showInformationMessage('Agent worktrees cleaned up');
    }

    // ========================================================================
    // Isolation Tier Management
    // ========================================================================

    async changeAgentIsolationTier(agentId: number, newTier: IsolationTier): Promise<boolean> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            this.debugLog(`Cannot change tier: agent ${agentId} not found`);
            return false;
        }

        const currentTier = agent.isolationTier || 'standard';
        if (currentTier === newTier) {
            this.debugLog(`Agent ${agentId} already at tier ${newTier}`);
            return true;
        }

        this.debugLog(`Changing agent ${agentId} isolation from ${currentTier} to ${newTier}`);

        try {
            if (currentTier !== 'standard') {
                await this.containerManager.removeContainer(agentId);
            }

            if (newTier !== 'standard') {
                const repoConfig = this.containerManager.loadRepoConfig(agent.repoPath);
                const containerInfo = await this.containerManager.createContainer(
                    agentId,
                    agent.worktreePath,
                    newTier,
                    repoConfig
                );
                agent.containerInfo = containerInfo;
            } else {
                agent.containerInfo = undefined;
            }

            agent.isolationTier = newTier;
            this.persistence.saveAgents(this.agents);

            return true;
        } catch (error) {
            this.debugLog(`Failed to change isolation tier: ${error}`);
            vscode.window.showErrorMessage(`Failed to change isolation tier: ${error}`);
            return false;
        }
    }

    async getAgentContainerStats(agentId: number): Promise<{ memoryMB: number; cpuPercent: number } | null> {
        return this.containerManager.getContainerStats(agentId);
    }

    // ========================================================================
    // Terminal Management
    // ========================================================================

    private createTerminalForAgent(agent: Agent, resumeSession: boolean = false): void {
        const config = getConfigService();
        const terminalService = getTerminalService();

        const terminal = terminalService.createAgentTerminal(
            agent.name,
            agent.worktreePath,
            agent.isolationTier,
            {
                autoStartClaude: config.autoStartClaude,
                claudeCommand: config.claudeCommand,
                sessionId: agent.sessionId,
                resumeSession,
                containerId: agent.containerInfo?.id,
            }
        );

        agent.terminal = terminal;
    }

    private ensureTerminalExists(agent: Agent): void {
        const terminalService = getTerminalService();

        if (agent.terminal && terminalService.isTerminalAlive(agent.terminal)) {
            return;
        }
        agent.terminal = null;

        const existingTerminal = terminalService.findTerminalByName(agent.name);
        if (existingTerminal) {
            agent.terminal = existingTerminal;
            return;
        }

        agent.terminal = terminalService.createTerminal({
            name: agent.name,
            cwd: agent.worktreePath,
            iconPath: getTerminalIcon(agent.isolationTier),
        });
    }

    async startClaudeInAgent(agentId: number): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            return;
        }

        this.ensureTerminalExists(agent);

        const claudeCmd = getConfigService().claudeCommand;
        const cmd = agent.sessionStarted
            ? `${claudeCmd} -r "${agent.sessionId}"`
            : `${claudeCmd} --session-id "${agent.sessionId}"`;

        agent.terminal!.show();
        agent.terminal!.sendText(cmd);

        if (!agent.sessionStarted) {
            agent.sessionStarted = true;
            this.persistence.saveAgents(this.agents);
        }

        agent.status = 'waiting-input';
        this.statusTracker.updateAgentIcon(agent);
    }

    focusAgent(agentId: number): void {
        const agent = this.agents.get(agentId);
        if (!agent) {
            vscode.window.showWarningMessage(`Agent ${agentId} not found`);
            return;
        }

        this.ensureTerminalExists(agent);

        if (agent.terminal) {
            agent.terminal.show(true);
        }
    }

    sendToAgent(agentId: number, text: string): void {
        const agent = this.agents.get(agentId);
        if (agent?.terminal) {
            const hadPendingApproval = agent.pendingApproval !== null;
            agent.terminal.sendText(text);
            agent.pendingApproval = null;
            agent.status = 'working';
            agent.lastInteractionTime = new Date();
            this.statusTracker.updateAgentIcon(agent);

            if (hadPendingApproval) {
                getEventBus().emit('approval:resolved', { agentId });
            }
        }
    }

    handleTerminalClosed(terminal: vscode.Terminal): void {
        for (const agent of this.agents.values()) {
            if (agent.terminal === terminal) {
                agent.terminal = null;
                agent.status = 'idle';
                this.statusTracker.updateAgentIcon(agent);
                getEventBus().emit('agent:terminalClosed', { agentId: agent.id });
                break;
            }
        }
    }

    // ========================================================================
    // Status & Queries (delegated to StatusTracker)
    // ========================================================================

    refreshStatus(): void {
        this.statusTracker.refreshStatus(this.agents);
    }

    async refreshDiffStats(): Promise<void> {
        await this.statusTracker.refreshDiffStats(this.agents);
    }

    getPendingApprovals(): PendingApproval[] {
        return this.statusTracker.getPendingApprovals(this.agents);
    }

    getWaitingCount(): number {
        return this.statusTracker.getWaitingCount(this.agents);
    }

    getAgents(): Agent[] {
        return Array.from(this.agents.values());
    }

    getAgent(id: number): Agent | undefined {
        return this.agents.get(id);
    }

    // ========================================================================
    // Git & Project Operations
    // ========================================================================

    async showAgentDiff(agentId: number): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            return;
        }

        try {
            const baseBranch = await getGitService().getBaseBranch(agent.repoPath);
            const windowsWorktreePath = this.toWindowsPath(agent.worktreePath);

            const output = await getCommandService().execAsync(
                `git diff --name-only ${baseBranch}...HEAD`,
                agent.worktreePath
            );

            const changedFiles = output.trim().split('\n').filter(f => f);

            if (changedFiles.length === 0) {
                vscode.window.showInformationMessage(`No changes in agent "${agent.name}"`);
                return;
            }

            const items = changedFiles.map(f => ({
                label: f,
                description: `${agent.name}: ${f}`
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Select file to view diff (${changedFiles.length} changed files)`,
                canPickMany: false
            });

            if (selected) {
                const filePath = path.join(windowsWorktreePath, selected.label);
                const uri = vscode.Uri.file(filePath);

                try {
                    await vscode.commands.executeCommand('git.openChange', uri);
                } catch {
                    await vscode.commands.executeCommand('vscode.open', uri);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show diff: ${error}`);
        }
    }

    isGitRepo(): boolean {
        if (!this.workspaceRoot) {
            return false;
        }
        try {
            this.execCommand('git rev-parse --git-dir', this.workspaceRoot);
            return true;
        } catch {
            return false;
        }
    }

    hasWorkspaceFolder(): boolean {
        return !!this.workspaceRoot;
    }

    async initializeProject(): Promise<{ success: boolean; message: string }> {
        if (!this.workspaceRoot) {
            return { success: false, message: 'No workspace folder open' };
        }

        if (this.isGitRepo()) {
            const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
            let gitignoreContent = '';

            if (fs.existsSync(gitignorePath)) {
                gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
            }

            if (!gitignoreContent.includes('.worktrees')) {
                const newLine = gitignoreContent.endsWith('\n') ? '' : '\n';
                fs.writeFileSync(gitignorePath, gitignoreContent + newLine + '.worktrees/\n');
            }

            return { success: true, message: 'Project already initialized. Added .worktrees to .gitignore.' };
        }

        try {
            this.execCommand('git init', this.workspaceRoot);

            const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
            let gitignoreContent = '';

            if (fs.existsSync(gitignorePath)) {
                gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
            }

            if (!gitignoreContent.includes('.worktrees')) {
                const newLine = gitignoreContent.endsWith('\n') || gitignoreContent === '' ? '' : '\n';
                fs.writeFileSync(gitignorePath, gitignoreContent + newLine + '.worktrees/\n');
            }

            this.execCommand('git add -A', this.workspaceRoot);
            try {
                this.execCommand('git commit -m "Initial commit"', this.workspaceRoot);
            } catch {
                // Might fail if nothing to commit
            }

            return { success: true, message: 'Git repository initialized and configured for Claude Agents.' };
        } catch (error) {
            return { success: false, message: `Failed to initialize: ${error}` };
        }
    }

    // ========================================================================
    // Task Management
    // ========================================================================

    getAvailableTasks(repoPath: string): string[] {
        const terminalPath = this.toTerminalPath(repoPath);
        const backlogPath = `${terminalPath}/.claude-agents/backlog`.replace(/\\/g, '/');

        try {
            const fsPath = agentPath(backlogPath).forNodeFs();
            const files = fs.readdirSync(fsPath);
            return files
                .filter(f => f.endsWith('.md'))
                .map(f => f.replace('.md', ''));
        } catch {
            return [];
        }
    }

    async createAgentForTask(taskName: string, repoPath?: string): Promise<Agent | null> {
        const repoPaths = this.getRepositoryPaths();

        if (repoPaths.length === 0) {
            vscode.window.showErrorMessage('No repository paths configured');
            return null;
        }

        let targetRepo = repoPath;
        if (!targetRepo) {
            if (repoPaths.length === 1) {
                targetRepo = repoPaths[0];
            } else {
                const picked = await vscode.window.showQuickPick(
                    repoPaths.map(p => ({ label: path.basename(p), description: p, path: p })),
                    { placeHolder: 'Select repository' }
                );
                if (!picked) {
                    return null;
                }
                targetRepo = picked.path;
            }
        }

        try {
            this.execCommand('git rev-parse --git-dir', targetRepo);
        } catch {
            vscode.window.showErrorMessage(`Not a git repository: ${targetRepo}`);
            return null;
        }

        const baseBranch = this.execCommand('git branch --show-current', targetRepo).trim();
        const repoTerminalPath = this.toTerminalPath(targetRepo);

        const branchName = `agent-${taskName}`;
        const worktreePath = `${repoTerminalPath}/${this.worktreeDir}/agent-${taskName}`.replace(/\\/g, '/');
        const agentId = this.agents.size + 1;

        try {
            this.execCommandSilent(`git worktree remove "${worktreePath}" --force`, targetRepo);
            this.execCommandSilent(`git branch -D "${branchName}"`, targetRepo);

            this.execCommand(`git worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`, targetRepo);

            const agent: Agent = {
                id: agentId,
                name: taskName,
                sessionId: this.persistence.generateSessionId(),
                branch: branchName,
                worktreePath,
                repoPath: targetRepo,
                taskFile: `${repoTerminalPath}/.claude-agents/backlog/${taskName}.md`.replace(/\\/g, '/'),
                terminal: null,
                status: 'idle',
                statusIcon: 'circle-outline',
                pendingApproval: null,
                lastInteractionTime: new Date(),
                diffStats: { insertions: 0, deletions: 0, filesChanged: 0 }
            };

            this.agents.set(agentId, agent);
            this.persistence.saveAgents(this.agents);
            this.createTerminalForAgent(agent);
            getEventBus().emit('agent:created', { agent });

            vscode.window.showInformationMessage(`Created agent for task: ${taskName}`);
            return agent;

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create agent for ${taskName}: ${error}`);
            return null;
        }
    }

    async initializeCoordination(repoPath: string, backlogPath?: string): Promise<{ success: boolean; message: string }> {
        const windowsRepoPath = this.toWindowsPath(repoPath);
        const agentsDir = path.join(windowsRepoPath, '.claude-agents');
        const claudeCommandsDir = path.join(windowsRepoPath, '.claude', 'commands');
        const claudeSkillsDir = path.join(windowsRepoPath, '.claude', 'skills');

        try {
            fs.mkdirSync(path.join(agentsDir, 'completed'), { recursive: true });
            fs.mkdirSync(claudeCommandsDir, { recursive: true });
            fs.mkdirSync(claudeSkillsDir, { recursive: true });

            const coordinationPath = getConfigService().coordinationScriptsPath;

            if (coordinationPath) {
                const windowsCoordPath = this.toWindowsPath(coordinationPath);
                const scriptSrc = path.join(windowsCoordPath, 'task-claimer.sh');
                const scriptDest = path.join(agentsDir, 'task-claimer.sh');

                if (fs.existsSync(scriptSrc)) {
                    fs.copyFileSync(scriptSrc, scriptDest);
                    try { fs.chmodSync(scriptDest, 0o755); } catch { /* ignore */ }
                }

                const claudeMdSrc = path.join(windowsCoordPath, 'agent-CLAUDE.md');
                const claudeMdDest = path.join(agentsDir, 'CLAUDE.md');
                if (fs.existsSync(claudeMdSrc)) {
                    fs.copyFileSync(claudeMdSrc, claudeMdDest);
                }

                const commandsSrcDir = path.join(windowsCoordPath, 'commands');
                if (fs.existsSync(commandsSrcDir)) {
                    const commands = fs.readdirSync(commandsSrcDir);
                    for (const cmd of commands) {
                        fs.copyFileSync(
                            path.join(commandsSrcDir, cmd),
                            path.join(claudeCommandsDir, cmd)
                        );
                    }
                }

                const skillsSrcDir = path.join(windowsCoordPath, 'skills');
                if (fs.existsSync(skillsSrcDir)) {
                    this.copyDirRecursive(skillsSrcDir, claudeSkillsDir);
                }
            }

            const backlogDir = path.join(agentsDir, 'backlog');
            if (backlogPath) {
                const windowsBacklogPath = this.toWindowsPath(backlogPath);
                try { fs.unlinkSync(backlogDir); } catch { /* ignore */ }
                try { fs.rmdirSync(backlogDir, { recursive: true }); } catch { /* ignore */ }
                fs.symlinkSync(windowsBacklogPath, backlogDir, 'junction');
            } else {
                fs.mkdirSync(backlogDir, { recursive: true });
            }

            const claimsFile = path.join(agentsDir, 'claims.jsonl');
            if (!fs.existsSync(claimsFile)) {
                fs.writeFileSync(claimsFile, '');
            }

            const gitignorePath = path.join(windowsRepoPath, '.gitignore');
            let gitignoreContent = '';
            if (fs.existsSync(gitignorePath)) {
                gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
            }

            const ignoreEntries = [
                '.claude-agents/completed/',
                '.claude-agents/claims.jsonl',
                '.claude-agents/.claims.lock'
            ];

            for (const entry of ignoreEntries) {
                if (!gitignoreContent.includes(entry)) {
                    gitignoreContent += `\n${entry}`;
                }
            }
            fs.writeFileSync(gitignorePath, gitignoreContent.trim() + '\n');

            return { success: true, message: 'Coordination files initialized' };
        } catch (error) {
            return { success: false, message: `Failed to initialize: ${error}` };
        }
    }

    async cleanupCompletedTasks(repoPath?: string): Promise<{ success: boolean; count: number }> {
        const repoPaths = repoPath ? [repoPath] : this.getRepositoryPaths();
        let totalCleaned = 0;

        for (const rp of repoPaths) {
            const terminalPath = this.toTerminalPath(rp);
            const completedDir = `${terminalPath}/.claude-agents/completed`.replace(/\\/g, '/');

            try {
                if (fs.existsSync(completedDir)) {
                    const files = fs.readdirSync(completedDir);
                    for (const file of files) {
                        fs.unlinkSync(`${completedDir}/${file}`);
                        totalCleaned++;
                    }
                }
            } catch { /* ignore */ }
        }

        return { success: true, count: totalCleaned };
    }

    private copyDirRecursive(src: string, dest: string): void {
        fs.mkdirSync(dest, { recursive: true });
        const entries = fs.readdirSync(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                this.copyDirRecursive(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }
}
