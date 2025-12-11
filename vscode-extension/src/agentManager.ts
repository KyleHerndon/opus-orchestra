import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync, exec } from 'child_process';
import { agentPath } from './pathUtils';

export type AgentStatus = 'idle' | 'working' | 'waiting-input' | 'waiting-approval' | 'stopped' | 'error';

export interface DiffStats {
    insertions: number;
    deletions: number;
    filesChanged: number;
}

// Persisted agent data (saved to disk)
export interface PersistedAgent {
    id: number;
    name: string;
    sessionId: string;  // Claude session UUID for resuming
    branch: string;
    worktreePath: string;
    repoPath: string;
    taskFile: string | null;
}

// Runtime agent data (includes terminal reference)
export interface Agent extends PersistedAgent {
    terminal: vscode.Terminal | null;
    status: AgentStatus;
    statusIcon: string;
    pendingApproval: string | null;
    lastInteractionTime: Date;
    diffStats: DiffStats;
}

export interface PendingApproval {
    agentId: number;
    description: string;
    timestamp: Date;
}

type TerminalType = 'wsl' | 'powershell' | 'cmd' | 'gitbash' | 'bash';

export class AgentManager {
    private agents: Map<number, Agent> = new Map();
    private workspaceRoot: string;
    private worktreeDir: string;
    private extensionPath: string;
    private context: vscode.ExtensionContext | null = null;

    constructor(extensionPath: string) {
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        this.extensionPath = extensionPath;
        const config = vscode.workspace.getConfiguration('claudeAgents');
        this.worktreeDir = config.get<string>('worktreeDirectory', '.worktrees');
    }

    // Must be called after construction to enable persistence
    setContext(context: vscode.ExtensionContext): void {
        this.context = context;
        this.restoreAgents();
    }

    // Get the storage key for persisted agents
    private getStorageKey(): string {
        return `claudeAgents.agents.${this.workspaceRoot}`;
    }

    // Debug logging to file (console.log output is not accessible)
    private debugLog(message: string): void {
        const logFile = path.join(this.extensionPath, 'debug.log');
        const timestamp = new Date().toISOString();
        fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
    }

    // Generate a UUID for Claude session
    private generateSessionId(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Word-based names for agents (NATO phonetic alphabet inspired, easy to distinguish)
    private readonly agentNames = [
        'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
        'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa',
        'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey',
        'xray', 'yankee', 'zulu'
    ];

    private getAgentName(id: number): string {
        if (id <= this.agentNames.length) {
            return this.agentNames[id - 1];
        }
        // For IDs beyond the list, use name + number (e.g., alpha-2)
        const baseIndex = (id - 1) % this.agentNames.length;
        const suffix = Math.floor((id - 1) / this.agentNames.length) + 1;
        return `${this.agentNames[baseIndex]}-${suffix}`;
    }

    // Save agents to persistent storage
    private saveAgents(): void {
        if (!this.context) {
            return;
        }

        const persistedAgents: PersistedAgent[] = [];
        for (const agent of this.agents.values()) {
            persistedAgents.push({
                id: agent.id,
                name: agent.name,
                sessionId: agent.sessionId,
                branch: agent.branch,
                worktreePath: agent.worktreePath,
                repoPath: agent.repoPath,
                taskFile: agent.taskFile
            });
        }

        this.context.workspaceState.update(this.getStorageKey(), persistedAgents);
    }

    // Restore agents from persistent storage
    private restoreAgents(): void {
        if (!this.context) {
            return;
        }

        const persistedAgents = this.context.workspaceState.get<PersistedAgent[]>(this.getStorageKey(), []);

        // Debug: log available terminals
        const terminalNames = vscode.window.terminals.map(t => t.name);
        this.debugLog(`[restoreAgents] Available terminals: ${JSON.stringify(terminalNames)}`);

        for (const persisted of persistedAgents) {
            this.debugLog(`[restoreAgents] Looking for terminal matching agent name: "${persisted.name}"`);

            // Try to find existing terminal for this agent
            const existingTerminal = vscode.window.terminals.find(
                t => t.name === persisted.name
            );

            this.debugLog(`[restoreAgents] Found terminal: ${existingTerminal ? existingTerminal.name : 'none'}`);

            const agent: Agent = {
                ...persisted,
                // Generate sessionId for old agents that don't have one
                sessionId: persisted.sessionId || this.generateSessionId(),
                terminal: existingTerminal || null,
                status: 'idle',
                statusIcon: existingTerminal ? 'circle-filled' : 'circle-outline',
                pendingApproval: null,
                lastInteractionTime: new Date(),
                diffStats: { insertions: 0, deletions: 0, filesChanged: 0 }
            };

            this.agents.set(agent.id, agent);
        }
    }

    // Get configured terminal type
    private getTerminalType(): TerminalType {
        const config = vscode.workspace.getConfiguration('claudeAgents');
        return config.get<TerminalType>('terminalType', 'wsl');
    }

    // Convert a path to the format expected by the configured terminal
    // Uses AgentPath for consistent cross-platform handling
    private toTerminalPath(inputPath: string): string {
        return agentPath(inputPath).forTerminal();
    }

    // Convert any path format to Windows path (for VS Code APIs like terminal cwd)
    // Uses AgentPath for consistent cross-platform handling
    private toWindowsPath(inputPath: string): string {
        return agentPath(inputPath).forNodeFs();
    }

    // Execute a command in the configured terminal environment
    private execCommand(command: string, cwd: string): string {
        const terminalType = this.getTerminalType();
        const terminalPath = this.toTerminalPath(cwd);

        switch (terminalType) {
            case 'wsl':
                // Run through WSL
                const escapedCmd = command.replace(/'/g, "'\\''");
                const wslCommand = `wsl bash -c "cd '${terminalPath}' && ${escapedCmd}"`;
                return execSync(wslCommand, { encoding: 'utf-8' });

            case 'gitbash':
                // Run through Git Bash
                const gitBashCmd = `"C:\\Program Files\\Git\\bin\\bash.exe" -c "cd '${terminalPath}' && ${command.replace(/'/g, "'\\''")}"`;
                return execSync(gitBashCmd, { encoding: 'utf-8' });

            case 'bash':
                // Run directly with bash (macOS/Linux)
                return execSync(command, { cwd: terminalPath, encoding: 'utf-8', shell: '/bin/bash' });

            case 'powershell':
            case 'cmd':
            default:
                // Run directly with Windows path
                return execSync(command, { cwd: terminalPath, encoding: 'utf-8' });
        }
    }

    // Execute a command silently (ignore errors and output)
    private execCommandSilent(command: string, cwd: string): void {
        try {
            const terminalType = this.getTerminalType();
            const terminalPath = this.toTerminalPath(cwd);

            switch (terminalType) {
                case 'wsl':
                    const escapedCmd = command.replace(/'/g, "'\\''");
                    execSync(`wsl bash -c "cd '${terminalPath}' && ${escapedCmd}"`, { stdio: 'ignore' });
                    break;

                case 'gitbash':
                    execSync(`"C:\\Program Files\\Git\\bin\\bash.exe" -c "cd '${terminalPath}' && ${command.replace(/'/g, "'\\''")}"`, { stdio: 'ignore' });
                    break;

                case 'bash':
                    execSync(command, { cwd: terminalPath, stdio: 'ignore', shell: '/bin/bash' });
                    break;

                case 'powershell':
                case 'cmd':
                default:
                    execSync(command, { cwd: terminalPath, stdio: 'ignore' });
                    break;
            }
        } catch {
            // Ignore errors
        }
    }

    // Recursively copy a directory
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

    getRepositoryPaths(): string[] {
        const config = vscode.workspace.getConfiguration('claudeAgents');
        const configuredPaths = config.get<string[]>('repositoryPaths', []);

        if (configuredPaths.length > 0) {
            // Return original paths for display, conversion happens when needed
            return configuredPaths;
        }

        // Fall back to workspace root
        return this.workspaceRoot ? [this.workspaceRoot] : [];
    }

    // Copy coordination files (slash commands, etc.) to a worktree
    private copyCoordinationToWorktree(agent: Agent): void {
        const config = vscode.workspace.getConfiguration('claudeAgents');
        const coordinationPath = config.get<string>('coordinationScriptsPath', '');

        try {
            // Use AgentPath for consistent path handling
            const worktreePath = agentPath(agent.worktreePath);
            const repoPath = agentPath(agent.repoPath);

            // Create directories in worktree (use forNodeFs() for fs operations)
            const worktreeCommandsDir = worktreePath.join('.claude', 'commands').forNodeFs();
            const worktreeAgentsDir = worktreePath.join('.claude-agents').forNodeFs();
            fs.mkdirSync(worktreeCommandsDir, { recursive: true });
            fs.mkdirSync(worktreeAgentsDir, { recursive: true });

            // Determine coordination source: configured path, or bundled with extension
            const bundledCoordPath = agentPath(this.extensionPath).join('coordination');
            const effectiveCoordPath = coordinationPath
                ? agentPath(coordinationPath)
                : bundledCoordPath;

            // Copy slash commands (e.g., claim.md)
            const commandsSrcDir = effectiveCoordPath.join('commands').forNodeFs();
            if (fs.existsSync(commandsSrcDir)) {
                const commands = fs.readdirSync(commandsSrcDir);
                for (const cmd of commands) {
                    fs.copyFileSync(
                        `${commandsSrcDir}/${cmd}`,
                        `${worktreeCommandsDir}/${cmd}`
                    );
                }
            }

            // Copy task-claimer.sh
            const claimerSrc = effectiveCoordPath.join('task-claimer.sh').forNodeFs();
            if (fs.existsSync(claimerSrc)) {
                const dest = `${worktreeAgentsDir}/task-claimer.sh`;
                fs.copyFileSync(claimerSrc, dest);
                try { fs.chmodSync(dest, 0o755); } catch { /* ignore */ }
            }

            // Copy agent-CLAUDE.md as CLAUDE.md if it exists
            const claudeMdSrc = effectiveCoordPath.join('agent-CLAUDE.md').forNodeFs();
            if (fs.existsSync(claudeMdSrc)) {
                fs.copyFileSync(claudeMdSrc, `${worktreeAgentsDir}/CLAUDE.md`);
            }

            // Copy hooks for status tracking
            const hooksSrcDir = effectiveCoordPath.join('hooks').forNodeFs();
            if (fs.existsSync(hooksSrcDir)) {
                const worktreeHooksDir = `${worktreeAgentsDir}/hooks`;
                fs.mkdirSync(worktreeHooksDir, { recursive: true });
                const hooks = fs.readdirSync(hooksSrcDir);
                for (const hook of hooks) {
                    const src = `${hooksSrcDir}/${hook}`;
                    const dest = `${worktreeHooksDir}/${hook}`;
                    fs.copyFileSync(src, dest);
                    try { fs.chmodSync(dest, 0o755); } catch { /* ignore */ }
                }
            }

            // Copy hooks.json to .claude/settings.json for this worktree
            const hooksJsonSrc = effectiveCoordPath.join('hooks.json').forNodeFs();
            if (fs.existsSync(hooksJsonSrc)) {
                const worktreeClaudeDir = worktreePath.join('.claude').forNodeFs();
                fs.mkdirSync(worktreeClaudeDir, { recursive: true });
                fs.copyFileSync(hooksJsonSrc, `${worktreeClaudeDir}/settings.json`);
            }

            // Create status directory
            fs.mkdirSync(`${worktreeAgentsDir}/status`, { recursive: true });

            // Also copy from main repo's .claude-agents if it exists (overrides bundled)
            const repoAgentsDir = repoPath.join('.claude-agents').forNodeFs();
            if (fs.existsSync(repoAgentsDir)) {
                // Copy task-claimer.sh
                const repoClaimerSrc = `${repoAgentsDir}/task-claimer.sh`;
                if (fs.existsSync(repoClaimerSrc)) {
                    const dest = `${worktreeAgentsDir}/task-claimer.sh`;
                    fs.copyFileSync(repoClaimerSrc, dest);
                    try { fs.chmodSync(dest, 0o755); } catch { /* ignore */ }
                }

                // Copy CLAUDE.md
                const repoClaudeMdSrc = `${repoAgentsDir}/CLAUDE.md`;
                if (fs.existsSync(repoClaudeMdSrc)) {
                    fs.copyFileSync(repoClaudeMdSrc, `${worktreeAgentsDir}/CLAUDE.md`);
                }
            }

            // Symlink or copy the backlog directory so agents can access tasks
            const backlogPathSetting = config.get<string>('backlogPath', '');
            if (backlogPathSetting) {
                const backlogPathObj = agentPath(backlogPathSetting);
                const worktreeBacklogDir = `${worktreeAgentsDir}/backlog`;

                // Remove existing backlog dir/link
                try { fs.unlinkSync(worktreeBacklogDir); } catch { /* ignore */ }
                try { fs.rmdirSync(worktreeBacklogDir, { recursive: true }); } catch { /* ignore */ }

                // Create symlink (junction on Windows)
                try {
                    fs.symlinkSync(backlogPathObj.forNodeFs(), worktreeBacklogDir, 'junction');
                } catch (e) {
                    // Fallback: copy the directory if symlink fails
                    // Symlink failed, copy directory instead
                    this.copyDirRecursive(backlogPathObj.forNodeFs(), worktreeBacklogDir);
                }
            }
        } catch (error) {
            console.error('[Claude Agents] Failed to copy coordination files:', error);
        }
    }

    async createAgents(count: number, repoPath?: string): Promise<void> {
        const repoPaths = this.getRepositoryPaths();

        if (repoPaths.length === 0) {
            vscode.window.showErrorMessage('No repository paths configured and no workspace folder open');
            return;
        }

        // If multiple repos configured and none specified, ask user to pick
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

        // Check if it's a git repo
        try {
            this.execCommand('git rev-parse --git-dir', targetRepo);
        } catch {
            vscode.window.showErrorMessage(`Not a git repository: ${targetRepo}`);
            return;
        }

        const baseBranch = this.execCommand('git branch --show-current', targetRepo).trim();
        const repoTerminalPath = this.toTerminalPath(targetRepo);

        // Find the next available agent ID to avoid duplicates
        const existingIds = new Set<number>();
        for (const agent of this.agents.values()) {
            if (agent.repoPath === targetRepo) {
                existingIds.add(agent.id);
            }
        }

        let createdCount = 0;
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Creating agent worktrees',
            cancellable: false
        }, async (progress) => {
            let nextId = 1;
            while (createdCount < count) {
                // Find next available ID
                while (existingIds.has(nextId)) {
                    nextId++;
                }

                const agentName = this.getAgentName(nextId);  // Display name (word-based)
                progress.report({ message: `Creating agent ${agentName}...`, increment: (100 / count) });

                const branchName = `claude-${agentName}`;
                const worktreePath = `${repoTerminalPath}/${this.worktreeDir}/claude-${agentName}`.replace(/\\/g, '/');

                try {
                    // Remove existing worktree if present
                    this.execCommandSilent(`git worktree remove "${worktreePath}" --force`, targetRepo);

                    // Delete branch if exists
                    this.execCommandSilent(`git branch -D "${branchName}"`, targetRepo);

                    // Create worktree with new branch
                    this.execCommand(`git worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`, targetRepo);

                    // Create agent entry with new session ID
                    const agent: Agent = {
                        id: nextId,
                        name: agentName,  // Display name without "claude-" prefix
                        sessionId: this.generateSessionId(),
                        branch: branchName,
                        worktreePath,
                        repoPath: targetRepo,
                        taskFile: null,
                        terminal: null,
                        status: 'idle',
                        statusIcon: 'circle-outline',
                        pendingApproval: null,
                        lastInteractionTime: new Date(),
                        diffStats: { insertions: 0, deletions: 0, filesChanged: 0 }
                    };

                    this.agents.set(nextId, agent);
                    existingIds.add(nextId);
                    createdCount++;

                    // Copy coordination files (slash commands, etc.) to the worktree
                    this.copyCoordinationToWorktree(agent);

                    // Create terminal for this agent
                    this.createTerminalForAgent(agent);

                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to create agent ${nextId}: ${error}`);
                }

                nextId++;
            }
        });

        // Persist agents to storage
        this.saveAgents();

        vscode.window.showInformationMessage(`Created ${createdCount} agent worktrees`);
    }

    private createTerminalForAgent(agent: Agent, resumeSession: boolean = false): void {
        // VS Code terminal needs Windows path for cwd
        const windowsCwd = this.toWindowsPath(agent.worktreePath);

        const terminal = vscode.window.createTerminal({
            name: agent.name,
            cwd: windowsCwd,
            iconPath: new vscode.ThemeIcon('hubot')
        });

        agent.terminal = terminal;

        // Auto-start Claude if configured
        const config = vscode.workspace.getConfiguration('claudeAgents');
        const autoStart = config.get<boolean>('autoStartClaude', true);

        if (autoStart) {
            const claudeCmd = config.get<string>('claudeCommand', 'claude');
            // Longer delay to let terminal fully initialize (especially on WSL)
            setTimeout(() => {
                if (resumeSession && agent.sessionId) {
                    terminal.sendText(`${claudeCmd} --resume "${agent.sessionId}"`);
                } else {
                    terminal.sendText(`${claudeCmd} --session-id "${agent.sessionId}"`);
                }
            }, 1000);
        }
    }

    async startClaudeInAgent(agentId: number): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            return;
        }

        // Ensure terminal exists (but don't auto-start Claude)
        this.ensureTerminalExists(agent);

        const config = vscode.workspace.getConfiguration('claudeAgents');
        const claudeCmd = config.get<string>('claudeCommand', 'claude');

        // Start Claude with session ID for this agent
        const cmd = `${claudeCmd} --session-id "${agent.sessionId}"`;
        agent.terminal!.show();
        agent.terminal!.sendText(cmd);

        // Set initial status to waiting-input (Claude starts waiting for user input)
        agent.status = 'waiting-input';
        this.updateAgentIcon(agent);
    }

    // Ensure agent has a terminal (without starting Claude)
    private ensureTerminalExists(agent: Agent): void {
        // Check if we have a valid terminal that still exists
        if (agent.terminal) {
            const stillExists = vscode.window.terminals.some(t => t === agent.terminal);
            if (stillExists) {
                return;
            }
            agent.terminal = null;
        }

        // Try to find existing terminal by name
        const existingTerminal = vscode.window.terminals.find(
            t => t.name === agent.name
        );

        if (existingTerminal) {
            agent.terminal = existingTerminal;
            return;
        }

        // Create terminal without starting Claude
        const windowsCwd = this.toWindowsPath(agent.worktreePath);
        const terminal = vscode.window.createTerminal({
            name: agent.name,
            cwd: windowsCwd,
            iconPath: new vscode.ThemeIcon('hubot')
        });
        agent.terminal = terminal;
    }

    getAgents(): Agent[] {
        return Array.from(this.agents.values());
    }

    getAgent(id: number): Agent | undefined {
        return this.agents.get(id);
    }

    focusAgent(agentId: number): void {
        const agent = this.agents.get(agentId);
        if (!agent) {
            vscode.window.showWarningMessage(`Agent ${agentId} not found`);
            return;
        }

        // Ensure we have a terminal (without auto-starting Claude)
        this.ensureTerminalExists(agent);

        if (agent.terminal) {
            agent.terminal.show(true); // true = preserve focus
        }
    }


    sendToAgent(agentId: number, text: string): void {
        const agent = this.agents.get(agentId);
        if (!agent) {
            this.debugLog(`[sendToAgent] Agent ${agentId} not found`);
            return;
        }
        if (!agent.terminal) {
            this.debugLog(`[sendToAgent] Agent ${agentId} (${agent.name}) has no terminal`);
            return;
        }
        this.debugLog(`[sendToAgent] Sending "${text}" to agent ${agentId} (${agent.name})`);
        agent.terminal.sendText(text);
        agent.pendingApproval = null;
        agent.status = 'working';
        agent.lastInteractionTime = new Date();
        this.updateAgentIcon(agent);
    }

    handleTerminalClosed(terminal: vscode.Terminal): void {
        for (const agent of this.agents.values()) {
            if (agent.terminal === terminal) {
                agent.terminal = null;
                agent.status = 'idle';
                this.updateAgentIcon(agent);
                break;
            }
        }
    }

    refreshStatus(): void {
        this.debugLog(`[refreshStatus] called, agents count: ${this.agents.size}`);
        for (const agent of this.agents.values()) {
            // Check hook-based status file
            this.checkHookStatus(agent);
            this.updateAgentIcon(agent);
        }
    }

    // Read status from hook-generated files
    // Looks for ANY status file in the worktree's status directory (most recent wins)
    private checkHookStatus(agent: Agent): void {
        try {
            // Use AgentPath for proper cross-platform path handling
            const agentPathObj = agentPath(agent.worktreePath);
            const statusDir = agentPathObj.join('.claude-agents', 'status').forNodeFs();

            // Debug logging
            this.debugLog(`[checkHookStatus] agent: ${agent.name}, worktreePath: ${agent.worktreePath}, statusDir: ${statusDir}, exists: ${fs.existsSync(statusDir)}`);

            if (!fs.existsSync(statusDir)) {
                return;
            }

            // Find the most recently modified status file
            const files = fs.readdirSync(statusDir);
            if (files.length === 0) {
                return;
            }

            let latestFile = '';
            let latestTime = 0;
            for (const file of files) {
                // Use forward slashes for path joining (works on Windows Node.js)
                const filePath = `${statusDir}/${file}`;
                try {
                    const stat = fs.statSync(filePath);
                    if (stat.mtimeMs > latestTime) {
                        latestTime = stat.mtimeMs;
                        latestFile = filePath;
                    }
                } catch {
                    // Skip files we can't stat
                }
            }

            if (!latestFile) {
                return;
            }

            const content = fs.readFileSync(latestFile, 'utf-8').trim();
            this.debugLog(`[checkHookStatus] agent: ${agent.name}, content length: ${content.length}`);

            // Try to parse as JSON (raw hook output)
            if (content.startsWith('{')) {
                try {
                    const data = JSON.parse(content);

                    // Check for PermissionRequest hook (has tool_name)
                    if (data.tool_name) {
                        agent.status = 'waiting-approval';
                        // Extract context based on tool type
                        let context = '';
                        if (data.tool_input) {
                            if (data.tool_name === 'Bash' && data.tool_input.command) {
                                context = data.tool_input.command;
                            } else if ((data.tool_name === 'Write' || data.tool_name === 'Edit') && data.tool_input.file_path) {
                                context = data.tool_input.file_path;
                            }
                        }
                        agent.pendingApproval = context ? `${data.tool_name}: ${context}` : data.tool_name;
                        this.debugLog(`[checkHookStatus] agent: ${agent.name}, permission request: ${agent.pendingApproval}`);
                        return;
                    }

                    // Check for other hook types by session_id presence
                    if (data.session_id) {
                        // Could be Stop, UserPromptSubmit, etc. - check for specific markers
                        // For now, if it's JSON with session_id but no tool_name, treat as working
                        agent.status = 'working';
                        agent.pendingApproval = null;
                        return;
                    }
                } catch (e) {
                    this.debugLog(`[checkHookStatus] agent: ${agent.name}, JSON parse error: ${e}`);
                }
            }

            // Legacy format parsing (simple status strings)
            if (content === 'working') {
                agent.status = 'working';
                agent.pendingApproval = null;
            } else if (content === 'waiting') {
                agent.status = 'waiting-input';
                agent.pendingApproval = null;
            } else if (content === 'stopped') {
                agent.status = 'stopped';
                agent.pendingApproval = null;
            }
        } catch {
            // Ignore errors reading status
        }
    }

    // Separate async diff refresh - call this on a longer interval
    async refreshDiffStats(): Promise<void> {
        const config = vscode.workspace.getConfiguration('claudeAgents');
        const diffInterval = config.get<number>('diffPollingInterval', 60000);

        // If disabled, skip
        if (diffInterval === 0) {
            return;
        }

        // Run all diff commands in parallel using async exec
        const promises: Promise<void>[] = [];

        for (const agent of this.agents.values()) {
            promises.push(this.getDiffStatsAsync(agent));
        }

        await Promise.all(promises);
    }

    private async getDiffStatsAsync(agent: Agent): Promise<void> {
        try {
            const baseBranch = await this.getBaseBranchAsync(agent.repoPath);
            const output = await this.execCommandAsync(
                `git diff --shortstat ${baseBranch}...HEAD`,
                agent.worktreePath
            );

            if (!output.trim()) {
                agent.diffStats = { insertions: 0, deletions: 0, filesChanged: 0 };
                return;
            }

            const filesMatch = output.match(/(\d+) files? changed/);
            const insertMatch = output.match(/(\d+) insertions?\(\+\)/);
            const deleteMatch = output.match(/(\d+) deletions?\(-\)/);

            agent.diffStats = {
                filesChanged: filesMatch ? parseInt(filesMatch[1]) : 0,
                insertions: insertMatch ? parseInt(insertMatch[1]) : 0,
                deletions: deleteMatch ? parseInt(deleteMatch[1]) : 0
            };
        } catch {
            // Keep existing stats on error
        }
    }

    private async getBaseBranchAsync(repoPath?: string): Promise<string> {
        try {
            const cwd = repoPath || this.workspaceRoot;
            const branches = await this.execCommandAsync('git branch -l main master', cwd);

            if (branches.includes('main')) {
                return 'main';
            }
            if (branches.includes('master')) {
                return 'master';
            }
            return 'HEAD~1';
        } catch {
            return 'HEAD~1';
        }
    }

    private execCommandAsync(command: string, cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const terminalType = this.getTerminalType();
            const terminalPath = this.toTerminalPath(cwd);

            let fullCommand: string;
            let execOptions: { cwd?: string; encoding: 'utf-8'; shell?: string } = { encoding: 'utf-8' };

            switch (terminalType) {
                case 'wsl':
                    const escapedCmd = command.replace(/'/g, "'\\''");
                    fullCommand = `wsl bash -c "cd '${terminalPath}' && ${escapedCmd}"`;
                    break;
                case 'gitbash':
                    fullCommand = `"C:\\Program Files\\Git\\bin\\bash.exe" -c "cd '${terminalPath}' && ${command.replace(/'/g, "'\\''")}"`;
                    break;
                case 'bash':
                    fullCommand = command;
                    execOptions.cwd = terminalPath;
                    execOptions.shell = '/bin/bash';
                    break;
                case 'powershell':
                case 'cmd':
                default:
                    fullCommand = command;
                    execOptions.cwd = terminalPath;
                    break;
            }

            exec(fullCommand, execOptions, (error, stdout) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout);
                }
            });
        });
    }


    private updateAgentIcon(agent: Agent): void {
        switch (agent.status) {
            case 'working':
                agent.statusIcon = 'sync~spin';
                break;
            case 'waiting-input':
                agent.statusIcon = 'bell';
                break;
            case 'waiting-approval':
                agent.statusIcon = 'question';
                break;
            case 'stopped':
                agent.statusIcon = 'debug-stop';
                break;
            case 'error':
                agent.statusIcon = 'error';
                break;
            default:
                agent.statusIcon = agent.terminal ? 'circle-filled' : 'circle-outline';
        }
    }

    getPendingApprovals(): PendingApproval[] {
        const approvals: PendingApproval[] = [];
        for (const agent of this.agents.values()) {
            if (agent.pendingApproval) {
                approvals.push({
                    agentId: agent.id,
                    description: agent.pendingApproval,
                    timestamp: new Date()
                });
            }
        }
        return approvals;
    }

    getWaitingCount(): number {
        let count = 0;
        for (const agent of this.agents.values()) {
            if (agent.status === 'waiting-input' || agent.status === 'waiting-approval') {
                count++;
            }
        }
        return count;
    }

    async cleanup(): Promise<void> {
        // Close all terminals
        for (const agent of this.agents.values()) {
            if (agent.terminal) {
                agent.terminal.dispose();
            }
        }

        // Remove worktrees
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Cleaning up worktrees',
            cancellable: false
        }, async (progress) => {
            for (const agent of this.agents.values()) {
                progress.report({ message: `Removing agent ${agent.id}...` });
                this.execCommandSilent(`git worktree remove "${agent.worktreePath}" --force`, agent.repoPath);
                this.execCommandSilent(`git branch -D "${agent.branch}"`, agent.repoPath);
            }
        });

        this.agents.clear();
        this.saveAgents();
        vscode.window.showInformationMessage('Agent worktrees cleaned up');
    }

    // Delete a single agent
    async deleteAgent(agentId: number): Promise<boolean> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            return false;
        }

        // Close terminal if open
        if (agent.terminal) {
            agent.terminal.dispose();
        }

        // Remove worktree and branch
        try {
            this.execCommandSilent(`git worktree remove "${agent.worktreePath}" --force`, agent.repoPath);
            this.execCommandSilent(`git branch -D "${agent.branch}"`, agent.repoPath);
        } catch {
            // Ignore errors during cleanup
        }

        this.agents.delete(agentId);
        this.saveAgents();
        vscode.window.showInformationMessage(`Agent ${agent.name || agentId} deleted`);
        return true;
    }

    async renameAgent(agentId: number, newName: string): Promise<boolean> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            return false;
        }

        // Sanitize the name (remove special characters, spaces -> hyphens)
        const sanitizedName = newName.trim()
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        if (!sanitizedName) {
            vscode.window.showErrorMessage('Invalid agent name');
            return false;
        }

        const oldBranch = agent.branch;
        const newBranch = `claude-${sanitizedName}`;
        const terminalPath = this.toTerminalPath(agent.repoPath);
        const newWorktreePath = `${terminalPath}/${this.worktreeDir}/claude-${sanitizedName}`.replace(/\\/g, '/');

        // Check if name already exists
        for (const a of this.agents.values()) {
            if (a.id !== agentId && a.name === sanitizedName) {
                vscode.window.showErrorMessage(`Agent name "${sanitizedName}" already exists`);
                return false;
            }
        }

        try {
            // Close terminal if open
            if (agent.terminal) {
                agent.terminal.dispose();
                agent.terminal = null;
            }

            // Move worktree: remove old, create new with same branch content
            this.execCommandSilent(`git worktree remove "${agent.worktreePath}" --force`, agent.repoPath);

            // Rename branch
            this.execCommand(`git branch -m "${oldBranch}" "${newBranch}"`, agent.repoPath);

            // Create new worktree
            this.execCommand(`git worktree add "${newWorktreePath}" "${newBranch}"`, agent.repoPath);

            // Update agent
            agent.name = sanitizedName;
            agent.branch = newBranch;
            agent.worktreePath = newWorktreePath;

            // Re-copy coordination files to new worktree
            this.copyCoordinationToWorktree(agent);

            this.saveAgents();
            vscode.window.showInformationMessage(`Agent renamed to "${sanitizedName}"`);
            return true;
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to rename agent: ${error}`);
            return false;
        }
    }

    async showAgentDiff(agentId: number): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            return;
        }

        try {
            const baseBranch = await this.getBaseBranchAsync(agent.repoPath);
            const windowsWorktreePath = this.toWindowsPath(agent.worktreePath);

            // Get list of changed files
            const output = await this.execCommandAsync(
                `git diff --name-only ${baseBranch}...HEAD`,
                agent.worktreePath
            );

            const changedFiles = output.trim().split('\n').filter(f => f);

            if (changedFiles.length === 0) {
                vscode.window.showInformationMessage(`No changes in agent "${agent.name}"`);
                return;
            }

            // Open VS Code's SCM diff view for the worktree
            // Use git.openChange command for each file, or show quick pick
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

                // Try to use git extension's diff view
                try {
                    await vscode.commands.executeCommand('git.openChange', uri);
                } catch {
                    // Fallback: just open the file
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

        // Check if already a git repo
        if (this.isGitRepo()) {
            // Add .worktrees to .gitignore if not present
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

        // Initialize git repo
        try {
            this.execCommand('git init', this.workspaceRoot);

            // Create .gitignore with .worktrees
            const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
            let gitignoreContent = '';

            if (fs.existsSync(gitignorePath)) {
                gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
            }

            if (!gitignoreContent.includes('.worktrees')) {
                const newLine = gitignoreContent.endsWith('\n') || gitignoreContent === '' ? '' : '\n';
                fs.writeFileSync(gitignorePath, gitignoreContent + newLine + '.worktrees/\n');
            }

            // Initial commit so worktrees can be created
            this.execCommand('git add -A', this.workspaceRoot);
            try {
                this.execCommand('git commit -m "Initial commit"', this.workspaceRoot);
            } catch {
                // Might fail if nothing to commit, that's ok
            }

            return { success: true, message: 'Git repository initialized and configured for Claude Agents.' };
        } catch (error) {
            return { success: false, message: `Failed to initialize: ${error}` };
        }
    }

    // Get available tasks from backlog
    getAvailableTasks(repoPath: string): string[] {
        const terminalPath = this.toTerminalPath(repoPath);
        const backlogPath = `${terminalPath}/.claude-agents/backlog`.replace(/\\/g, '/');

        try {
            // For file system operations, we need to handle the path based on terminal type
            const terminalType = this.getTerminalType();
            let fsPath: string;

            if (terminalType === 'wsl') {
                // WSL paths work with Node's fs on Windows
                fsPath = backlogPath;
            } else {
                // For Windows terminals, use Windows path
                fsPath = backlogPath.replace(/\//g, '\\');
            }

            const files = fs.readdirSync(fsPath);
            return files
                .filter(f => f.endsWith('.md'))
                .map(f => f.replace('.md', ''));
        } catch {
            return [];
        }
    }

    // Create an agent for a specific task
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

        // Check if it's a git repo
        try {
            this.execCommand('git rev-parse --git-dir', targetRepo);
        } catch {
            vscode.window.showErrorMessage(`Not a git repository: ${targetRepo}`);
            return null;
        }

        const baseBranch = this.execCommand('git branch --show-current', targetRepo).trim();
        const repoTerminalPath = this.toTerminalPath(targetRepo);

        // Create branch/worktree named after task
        const branchName = `agent-${taskName}`;
        const worktreePath = `${repoTerminalPath}/${this.worktreeDir}/agent-${taskName}`.replace(/\\/g, '/');
        const agentId = this.agents.size + 1;

        try {
            // Remove existing worktree if present
            this.execCommandSilent(`git worktree remove "${worktreePath}" --force`, targetRepo);

            // Delete branch if exists
            this.execCommandSilent(`git branch -D "${branchName}"`, targetRepo);

            // Create worktree with new branch
            this.execCommand(`git worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`, targetRepo);

            const agent: Agent = {
                id: agentId,
                name: taskName,
                sessionId: this.generateSessionId(),
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
            this.saveAgents();
            this.createTerminalForAgent(agent);

            vscode.window.showInformationMessage(`Created agent for task: ${taskName}`);
            return agent;

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create agent for ${taskName}: ${error}`);
            return null;
        }
    }

    // Initialize coordination files in a repository
    async initializeCoordination(repoPath: string, backlogPath?: string): Promise<{ success: boolean; message: string }> {
        // Use Windows paths for fs operations
        const windowsRepoPath = this.toWindowsPath(repoPath);
        const agentsDir = path.join(windowsRepoPath, '.claude-agents');
        const claudeCommandsDir = path.join(windowsRepoPath, '.claude', 'commands');
        const claudeSkillsDir = path.join(windowsRepoPath, '.claude', 'skills');

        try {
            // Create directories
            fs.mkdirSync(path.join(agentsDir, 'completed'), { recursive: true });
            fs.mkdirSync(claudeCommandsDir, { recursive: true });
            fs.mkdirSync(claudeSkillsDir, { recursive: true });

            // Copy coordination script
            const config = vscode.workspace.getConfiguration('claudeAgents');
            const coordinationPath = config.get<string>('coordinationScriptsPath', '');

            if (coordinationPath) {
                const windowsCoordPath = this.toWindowsPath(coordinationPath);
                const scriptSrc = path.join(windowsCoordPath, 'task-claimer.sh');
                const scriptDest = path.join(agentsDir, 'task-claimer.sh');

                if (fs.existsSync(scriptSrc)) {
                    fs.copyFileSync(scriptSrc, scriptDest);
                    try {
                        fs.chmodSync(scriptDest, 0o755);
                    } catch { /* ignore on Windows */ }
                }

                // Copy CLAUDE.md
                const claudeMdSrc = path.join(windowsCoordPath, 'agent-CLAUDE.md');
                const claudeMdDest = path.join(agentsDir, 'CLAUDE.md');
                if (fs.existsSync(claudeMdSrc)) {
                    fs.copyFileSync(claudeMdSrc, claudeMdDest);
                }

                // Copy slash commands
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

                // Copy skills
                const skillsSrcDir = path.join(windowsCoordPath, 'skills');
                if (fs.existsSync(skillsSrcDir)) {
                    this.copyDirRecursive(skillsSrcDir, claudeSkillsDir);
                }
            }

            // Create or link backlog
            const backlogDir = path.join(agentsDir, 'backlog');
            if (backlogPath) {
                const windowsBacklogPath = this.toWindowsPath(backlogPath);
                // Remove existing
                try {
                    fs.unlinkSync(backlogDir);
                } catch { /* ignore */ }
                try {
                    fs.rmdirSync(backlogDir, { recursive: true });
                } catch { /* ignore */ }
                // Create symlink (use junction on Windows for directories)
                fs.symlinkSync(windowsBacklogPath, backlogDir, 'junction');
            } else {
                fs.mkdirSync(backlogDir, { recursive: true });
            }

            // Initialize claims file
            const claimsFile = path.join(agentsDir, 'claims.jsonl');
            if (!fs.existsSync(claimsFile)) {
                fs.writeFileSync(claimsFile, '');
            }

            // Update .gitignore
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

    // Clean up completed tasks
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
}
