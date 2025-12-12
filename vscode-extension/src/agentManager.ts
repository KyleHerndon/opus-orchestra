import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { agentPath } from './pathUtils';
import { ContainerManager } from './containerManager';

// Import types from centralized types module
import {
    Agent,
    AgentStatus,
    PersistedAgent,
    DiffStats,
    PendingApproval,
    IsolationTier,
    ContainerInfo,
    AGENT_NAMES,
    STATUS_ICONS,
} from './types';

// Import services
import {
    getConfigService,
    getCommandService,
    getGitService,
    getTerminalService,
    getStatusService,
    getEventBus,
    getLogger,
    isLoggerInitialized,
    getTerminalIcon,
    getPersistenceService,
    isPersistenceServiceInitialized,
} from './services';

// Re-export types for backward compatibility
export { Agent, AgentStatus, PersistedAgent, DiffStats, PendingApproval, IsolationTier, ContainerInfo };

export class AgentManager {
    private agents: Map<number, Agent> = new Map();
    private workspaceRoot: string;
    private extensionPath: string;
    private containerManager: ContainerManager;

    constructor(extensionPath: string) {
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        this.extensionPath = extensionPath;
        this.containerManager = new ContainerManager(extensionPath);
    }

    // Convenience getter for worktree directory
    private get worktreeDir(): string {
        return getConfigService().worktreeDirectory;
    }

    // Must be called after construction to enable persistence
    setContext(context: vscode.ExtensionContext): void {
        this.containerManager.setContext(context);
        this.restoreAgents();
    }

    // Get the container manager for external access
    getContainerManager(): ContainerManager {
        return this.containerManager;
    }

    // Debug logging via Logger service
    private debugLog(message: string): void {
        if (isLoggerInitialized()) {
            getLogger().child('AgentManager').debug(message);
        }
    }

    // Generate a UUID for Claude session
    private generateSessionId(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Get agent name from NATO phonetic alphabet
    private getAgentName(id: number): string {
        if (id <= AGENT_NAMES.length) {
            return AGENT_NAMES[id - 1];
        }
        // For IDs beyond the list, use name + number (e.g., alpha-2)
        const baseIndex = (id - 1) % AGENT_NAMES.length;
        const suffix = Math.floor((id - 1) / AGENT_NAMES.length) + 1;
        return `${AGENT_NAMES[baseIndex]}-${suffix}`;
    }

    // Save agents to persistent storage (both VS Code state and worktree metadata)
    private saveAgents(): void {
        // Save to VS Code workspace state
        if (isPersistenceServiceInitialized()) {
            getPersistenceService().saveAgents(this.agents);
        }

        // Save to worktree metadata files (source of truth)
        for (const agent of this.agents.values()) {
            this.saveAgentToWorktree(agent);
        }
    }

    // Restore agents from worktree metadata (primary) and VS Code state (fallback)
    private restoreAgents(): void {
        this.debugLog(`[restoreAgents] Starting agent restoration`);

        // First, scan worktrees for agents (this is the source of truth)
        const repoPaths = this.getRepositoryPaths();
        const worktreeAgents = new Map<string, PersistedAgent>();

        for (const repoPath of repoPaths) {
            const agents = this.scanWorktreesForAgents(repoPath);
            for (const agent of agents) {
                // Use worktreePath as unique key
                worktreeAgents.set(agent.worktreePath, agent);
            }
        }

        this.debugLog(`[restoreAgents] Found ${worktreeAgents.size} agents in worktrees`);

        // Also load from VS Code state as fallback (for agents without worktree metadata)
        let vscodeAgents: PersistedAgent[] = [];
        if (isPersistenceServiceInitialized()) {
            vscodeAgents = getPersistenceService().loadPersistedAgents();
            this.debugLog(`[restoreAgents] Found ${vscodeAgents.length} agents in VS Code state`);
        }

        // Merge: worktree metadata takes priority
        const allAgents = new Map<string, PersistedAgent>();

        // Add VS Code state agents first
        for (const agent of vscodeAgents) {
            allAgents.set(agent.worktreePath, agent);
        }

        // Override with worktree metadata (source of truth)
        for (const [path, agent] of worktreeAgents) {
            allAgents.set(path, agent);
        }

        // Log available terminals for debugging
        const terminalNames = vscode.window.terminals.map(t => t.name);
        this.debugLog(`[restoreAgents] Available terminals: ${JSON.stringify(terminalNames)}`);

        // Create Agent objects from persisted data
        for (const persisted of allAgents.values()) {
            // Try to find existing terminal for this agent
            const existingTerminal = vscode.window.terminals.find(
                t => t.name === persisted.name
            );

            // Get container info if this agent is containerized
            const containerInfo = this.containerManager.getContainer(persisted.id);

            const agent: Agent = {
                ...persisted,
                // Generate sessionId for old agents that don't have one
                sessionId: persisted.sessionId || this.generateSessionId(),
                terminal: existingTerminal || null,
                status: 'idle',
                statusIcon: existingTerminal ? 'circle-filled' : 'circle-outline',
                pendingApproval: null,
                lastInteractionTime: new Date(),
                diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
                containerInfo,
            };

            this.agents.set(agent.id, agent);
            this.debugLog(`[restoreAgents] Restored agent ${agent.name} (id=${agent.id})`);
        }

        this.debugLog(`[restoreAgents] Restored ${this.agents.size} total agents`);
    }

    // Convert a path to the format expected by the configured terminal
    private toTerminalPath(inputPath: string): string {
        return agentPath(inputPath).forTerminal();
    }

    // Convert any path format to Windows path (for VS Code APIs like terminal cwd)
    private toWindowsPath(inputPath: string): string {
        return agentPath(inputPath).forNodeFs();
    }

    // Execute a command using CommandService
    private execCommand(command: string, cwd: string): string {
        return getCommandService().exec(command, cwd);
    }

    // Execute a command silently using CommandService
    private execCommandSilent(command: string, cwd: string): void {
        getCommandService().execSilent(command, cwd);
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
        const configuredPaths = getConfigService().repositoryPaths;

        if (configuredPaths.length > 0) {
            return configuredPaths;
        }

        // Fall back to workspace root
        return this.workspaceRoot ? [this.workspaceRoot] : [];
    }

    // ========================================================================
    // Worktree Metadata Persistence
    // ========================================================================

    private readonly METADATA_DIR = '.opus-orchestra';
    private readonly METADATA_FILE = 'agent.json';

    /**
     * Save agent metadata to the worktree for persistence across sessions
     */
    private saveAgentToWorktree(agent: Agent): void {
        try {
            const worktreePath = agentPath(agent.worktreePath);
            const metadataDir = worktreePath.join(this.METADATA_DIR).forNodeFs();
            const metadataFile = `${metadataDir}/${this.METADATA_FILE}`;

            fs.mkdirSync(metadataDir, { recursive: true });

            const metadata: PersistedAgent = {
                id: agent.id,
                name: agent.name,
                sessionId: agent.sessionId,
                branch: agent.branch,
                worktreePath: agent.worktreePath,
                repoPath: agent.repoPath,
                taskFile: agent.taskFile,
                isolationTier: agent.isolationTier,
                sessionStarted: agent.sessionStarted,
            };

            fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
            this.debugLog(`Saved agent metadata to ${metadataFile}`);
        } catch (error) {
            this.debugLog(`Failed to save agent metadata: ${error}`);
        }
    }

    /**
     * Load agent metadata from a worktree
     */
    private loadAgentFromWorktree(worktreePath: string): PersistedAgent | null {
        try {
            const wtPath = agentPath(worktreePath);
            const metadataFile = wtPath.join(this.METADATA_DIR, this.METADATA_FILE).forNodeFs();

            if (!fs.existsSync(metadataFile)) {
                return null;
            }

            const content = fs.readFileSync(metadataFile, 'utf-8');
            const metadata = JSON.parse(content) as PersistedAgent;
            this.debugLog(`Loaded agent metadata from ${metadataFile}`);
            return metadata;
        } catch (error) {
            this.debugLog(`Failed to load agent metadata from ${worktreePath}: ${error}`);
            return null;
        }
    }

    /**
     * Scan worktrees directory for existing agents and restore them
     */
    private scanWorktreesForAgents(repoPath: string): PersistedAgent[] {
        const agents: PersistedAgent[] = [];
        const repoTerminalPath = this.toTerminalPath(repoPath);
        const worktreesDir = agentPath(`${repoTerminalPath}/${this.worktreeDir}`).forNodeFs();

        this.debugLog(`Scanning worktrees directory: ${worktreesDir}`);

        if (!fs.existsSync(worktreesDir)) {
            this.debugLog(`Worktrees directory does not exist`);
            return agents;
        }

        try {
            const entries = fs.readdirSync(worktreesDir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) {
                    continue;
                }

                // Only look at directories that look like agent worktrees (claude-* or agent-*)
                if (!entry.name.startsWith('claude-') && !entry.name.startsWith('agent-')) {
                    continue;
                }

                const worktreePath = `${repoTerminalPath}/${this.worktreeDir}/${entry.name}`;
                const metadata = this.loadAgentFromWorktree(worktreePath);

                if (metadata) {
                    // Update worktreePath in case it was moved
                    metadata.worktreePath = worktreePath;
                    metadata.repoPath = repoPath;
                    agents.push(metadata);
                    this.debugLog(`Found agent in worktree: ${entry.name}`);
                }
            }
        } catch (error) {
            this.debugLog(`Failed to scan worktrees: ${error}`);
        }

        return agents;
    }

    /**
     * Check if a worktree exists at the given path
     */
    private worktreeExists(worktreePath: string): boolean {
        const fsPath = agentPath(worktreePath).forNodeFs();
        return fs.existsSync(fsPath);
    }

    // Copy coordination files (slash commands, etc.) to a worktree
    private copyCoordinationToWorktree(agent: Agent): void {
        const config = getConfigService();
        const coordinationPath = config.coordinationScriptsPath;

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
            const backlogPathSetting = config.backlogPath;
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

            // Ensure .opus-orchestra is in .gitignore so agent metadata isn't committed
            const gitignorePath = worktreePath.join('.gitignore').forNodeFs();
            let gitignoreContent = '';
            if (fs.existsSync(gitignorePath)) {
                gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
            }
            if (!gitignoreContent.includes('.opus-orchestra')) {
                const newLine = gitignoreContent.length > 0 && !gitignoreContent.endsWith('\n') ? '\n' : '';
                fs.writeFileSync(gitignorePath, gitignoreContent + newLine + '.opus-orchestra/\n');
            }
        } catch (error) {
            console.error('[Claude Agents] Failed to copy coordination files:', error);
        }
    }

    async createAgents(count: number, repoPath?: string, isolationTier?: IsolationTier): Promise<void> {
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

        // Get default isolation tier from settings if not specified
        const defaultTier = isolationTier || getConfigService().isolationTier;

        // Load repo-specific container config
        const repoConfig = this.containerManager.loadRepoConfig(targetRepo);

        // Validate isolation tier is available
        const availableTiers = await this.containerManager.getAvailableTiers();
        if (!availableTiers.includes(defaultTier)) {
            const fallback = availableTiers[availableTiers.length - 1];  // Highest available
            const useAlternative = await vscode.window.showWarningMessage(
                `Isolation tier '${defaultTier}' is not available. Use '${fallback}' instead?`,
                'Yes', 'No'
            );
            if (useAlternative !== 'Yes') {
                return;
            }
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
        let restoredCount = 0;
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Creating agent worktrees',
            cancellable: false
        }, async (progress) => {
            let nextId = 1;
            while (createdCount + restoredCount < count) {
                // Find next available ID
                while (existingIds.has(nextId)) {
                    nextId++;
                }

                const agentName = this.getAgentName(nextId);  // Display name (word-based)
                progress.report({ message: `Creating agent ${agentName}...`, increment: (100 / count) });

                const branchName = `claude-${agentName}`;
                const worktreePath = `${repoTerminalPath}/${this.worktreeDir}/claude-${agentName}`.replace(/\\/g, '/');

                try {
                    // Check if worktree already exists - NEVER delete existing worktrees
                    if (this.worktreeExists(worktreePath)) {
                        // Try to restore from existing worktree metadata
                        const existingMetadata = this.loadAgentFromWorktree(worktreePath);

                        if (existingMetadata) {
                            this.debugLog(`Restoring existing agent from worktree: ${agentName}`);

                            const agent: Agent = {
                                id: existingMetadata.id || nextId,
                                name: existingMetadata.name || agentName,
                                sessionId: existingMetadata.sessionId || this.generateSessionId(),
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

                            // Create terminal for this agent
                            this.createTerminalForAgent(agent, agent.sessionStarted);

                            // Emit agent created event
                            getEventBus().emit('agent:created', { agent });

                            nextId++;
                            continue;
                        } else {
                            // Worktree exists but no metadata - create metadata for it
                            this.debugLog(`Worktree exists without metadata, adopting: ${agentName}`);
                        }
                    } else {
                        // Create new worktree (don't delete branch - it might have commits)
                        this.execCommand(`git worktree add -B "${branchName}" "${worktreePath}" "${baseBranch}"`, targetRepo);
                    }

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
                        diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
                        isolationTier: defaultTier
                    };

                    this.agents.set(nextId, agent);
                    existingIds.add(nextId);
                    createdCount++;

                    // Copy coordination files (slash commands, etc.) to the worktree
                    this.copyCoordinationToWorktree(agent);

                    // Save agent metadata to worktree for persistence
                    this.saveAgentToWorktree(agent);

                    // Create container/sandbox if not standard mode
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

                    // Create terminal for this agent
                    this.createTerminalForAgent(agent);

                    // Emit agent created event
                    getEventBus().emit('agent:created', { agent });

                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to create agent ${nextId}: ${error}`);
                }

                nextId++;
            }
        });

        // Persist agents to storage (both VS Code state and worktree metadata)
        this.saveAgents();

        const tierInfo = defaultTier !== 'standard' ? ` (${defaultTier} isolation)` : '';
        const message = restoredCount > 0
            ? `Created ${createdCount} new, restored ${restoredCount} existing agent worktrees${tierInfo}`
            : `Created ${createdCount} agent worktrees${tierInfo}`;
        vscode.window.showInformationMessage(message);
    }

    // Get available isolation tiers
    async getAvailableIsolationTiers(): Promise<IsolationTier[]> {
        return this.containerManager.getAvailableTiers();
    }

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

    async startClaudeInAgent(agentId: number): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            return;
        }

        // Ensure terminal exists (but don't auto-start Claude)
        this.ensureTerminalExists(agent);

        const claudeCmd = getConfigService().claudeCommand;

        // Use -r to resume if session was previously started, otherwise create new with --session-id
        const cmd = agent.sessionStarted
            ? `${claudeCmd} -r "${agent.sessionId}"`
            : `${claudeCmd} --session-id "${agent.sessionId}"`;
        agent.terminal!.show();
        agent.terminal!.sendText(cmd);

        // Mark session as started so future calls will resume
        if (!agent.sessionStarted) {
            agent.sessionStarted = true;
            this.saveAgents();
        }

        // Set initial status to waiting-input (Claude starts waiting for user input)
        agent.status = 'waiting-input';
        this.updateAgentIcon(agent);
    }

    // Ensure agent has a terminal (without starting Claude)
    private ensureTerminalExists(agent: Agent): void {
        const terminalService = getTerminalService();

        // Check if we have a valid terminal that still exists
        if (agent.terminal && terminalService.isTerminalAlive(agent.terminal)) {
            return;
        }
        agent.terminal = null;

        // Try to find existing terminal by name
        const existingTerminal = terminalService.findTerminalByName(agent.name);
        if (existingTerminal) {
            agent.terminal = existingTerminal;
            return;
        }

        // Create terminal without starting Claude
        agent.terminal = terminalService.createTerminal({
            name: agent.name,
            cwd: agent.worktreePath,
            iconPath: getTerminalIcon(agent.isolationTier),
        });
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
        if (agent?.terminal) {
            const hadPendingApproval = agent.pendingApproval !== null;
            agent.terminal.sendText(text);
            agent.pendingApproval = null;
            agent.status = 'working';
            agent.lastInteractionTime = new Date();
            this.updateAgentIcon(agent);

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
                this.updateAgentIcon(agent);
                getEventBus().emit('agent:terminalClosed', { agentId: agent.id });
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

    // Read status from hook-generated files using StatusService
    private checkHookStatus(agent: Agent): void {
        const parsedStatus = getStatusService().checkStatus(agent.worktreePath);
        if (parsedStatus) {
            const previousStatus = agent.status;
            const hadApproval = agent.pendingApproval !== null;

            agent.status = parsedStatus.status;
            agent.pendingApproval = parsedStatus.pendingApproval;

            // Emit status change event if status actually changed
            if (previousStatus !== agent.status) {
                getEventBus().emit('agent:statusChanged', { agent, previousStatus });
            }

            // Emit approval pending event if new approval appeared
            if (!hadApproval && agent.pendingApproval !== null) {
                getEventBus().emit('approval:pending', {
                    approval: {
                        agentId: agent.id,
                        description: agent.pendingApproval,
                        timestamp: new Date(),
                    }
                });
            }
        }
    }

    // Separate async diff refresh - call this on a longer interval
    async refreshDiffStats(): Promise<void> {
        const diffInterval = getConfigService().diffPollingInterval;

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
            const gitService = getGitService();
            const baseBranch = await gitService.getBaseBranch(agent.repoPath);
            agent.diffStats = await gitService.getDiffStats(agent.worktreePath, baseBranch);
        } catch {
            // Keep existing stats on error
        }
    }

    private async getBaseBranchAsync(repoPath?: string): Promise<string> {
        const cwd = repoPath || this.workspaceRoot;
        return getGitService().getBaseBranch(cwd);
    }

    private execCommandAsync(command: string, cwd: string): Promise<string> {
        return getCommandService().execAsync(command, cwd);
    }


    private updateAgentIcon(agent: Agent): void {
        if (agent.status === 'idle') {
            // Idle status depends on terminal state
            agent.statusIcon = agent.terminal ? 'circle-filled' : 'circle-outline';
        } else {
            agent.statusIcon = STATUS_ICONS[agent.status];
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
        // Close all terminals and containers
        for (const agent of this.agents.values()) {
            if (agent.terminal) {
                agent.terminal.dispose();
            }
            // Remove container if exists
            if (agent.containerInfo) {
                await this.containerManager.removeContainer(agent.id);
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

        // Remove container if exists
        if (agent.containerInfo) {
            await this.containerManager.removeContainer(agentId);
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
        getEventBus().emit('agent:deleted', { agentId });
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

        const previousName = agent.name;

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
            getEventBus().emit('agent:renamed', { agent, previousName });
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
            // Convert to Windows path for fs operations
            const fsPath = agentPath(backlogPath).forNodeFs();

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
            getEventBus().emit('agent:created', { agent });

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
            const coordinationPath = getConfigService().coordinationScriptsPath;

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
