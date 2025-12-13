import * as fs from 'fs';
import * as path from 'path';
import { agentPath } from '../pathUtils';
import { PersistedAgent, Agent } from '../types';
import { getConfigService, getCommandService, getLogger, isLoggerInitialized } from '../services';

/**
 * Manages git worktree operations for agents.
 * Responsible for creating, removing, and scanning worktrees.
 */
export class WorktreeManager {
    private readonly METADATA_DIR = '.opus-orchestra';
    private readonly METADATA_FILE = 'agent.json';

    constructor(private extensionPath: string) {}

    private get worktreeDir(): string {
        return getConfigService().worktreeDirectory;
    }

    private debugLog(message: string): void {
        if (isLoggerInitialized()) {
            getLogger().child('WorktreeManager').debug(message);
        }
    }

    private toTerminalPath(inputPath: string): string {
        return agentPath(inputPath).forTerminal();
    }

    private execCommand(command: string, cwd: string): string {
        return getCommandService().exec(command, cwd);
    }

    private execCommandSilent(command: string, cwd: string): void {
        getCommandService().execSilent(command, cwd);
    }

    /**
     * Check if a worktree exists at the given path
     */
    worktreeExists(worktreePath: string): boolean {
        const fsPath = agentPath(worktreePath).forNodeFs();
        return fs.existsSync(fsPath);
    }

    /**
     * Create a new git worktree
     */
    createWorktree(repoPath: string, worktreePath: string, branchName: string, baseBranch: string): void {
        this.execCommand(
            `git worktree add -B "${branchName}" "${worktreePath}" "${baseBranch}"`,
            repoPath
        );
    }

    /**
     * Remove a git worktree and optionally its branch
     */
    removeWorktree(repoPath: string, worktreePath: string, branchName?: string): void {
        this.execCommandSilent(`git worktree remove "${worktreePath}" --force`, repoPath);
        if (branchName) {
            this.execCommandSilent(`git branch -D "${branchName}"`, repoPath);
        }
    }

    /**
     * Rename a worktree (remove old, create new)
     */
    renameWorktree(
        repoPath: string,
        oldWorktreePath: string,
        newWorktreePath: string,
        oldBranch: string,
        newBranch: string
    ): void {
        // Remove old worktree
        this.execCommandSilent(`git worktree remove "${oldWorktreePath}" --force`, repoPath);

        // Rename branch
        this.execCommand(`git branch -m "${oldBranch}" "${newBranch}"`, repoPath);

        // Create new worktree with renamed branch
        this.execCommand(`git worktree add "${newWorktreePath}" "${newBranch}"`, repoPath);
    }

    /**
     * Get the worktree path for an agent
     */
    getWorktreePath(repoPath: string, agentName: string): string {
        const repoTerminalPath = this.toTerminalPath(repoPath);
        return `${repoTerminalPath}/${this.worktreeDir}/claude-${agentName}`.replace(/\\/g, '/');
    }

    /**
     * Scan worktrees directory for existing agents
     */
    scanWorktreesForAgents(repoPath: string): PersistedAgent[] {
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

                // Only look at directories that look like agent worktrees
                if (!entry.name.startsWith('claude-') && !entry.name.startsWith('agent-')) {
                    continue;
                }

                const worktreePath = `${repoTerminalPath}/${this.worktreeDir}/${entry.name}`;
                const metadata = this.loadAgentMetadata(worktreePath);

                if (metadata) {
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
     * Save agent metadata to worktree
     */
    saveAgentMetadata(agent: Agent): void {
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
     * Load agent metadata from worktree
     */
    loadAgentMetadata(worktreePath: string): PersistedAgent | null {
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
     * Copy coordination files to a worktree
     */
    copyCoordinationFiles(agent: Agent): void {
        const config = getConfigService();
        const coordinationPath = config.coordinationScriptsPath;

        try {
            const worktreePath = agentPath(agent.worktreePath);
            const repoPath = agentPath(agent.repoPath);

            // Create directories
            const worktreeCommandsDir = worktreePath.join('.claude', 'commands').forNodeFs();
            const worktreeAgentsDir = worktreePath.join('.claude-agents').forNodeFs();
            fs.mkdirSync(worktreeCommandsDir, { recursive: true });
            fs.mkdirSync(worktreeAgentsDir, { recursive: true });

            // Determine coordination source
            const bundledCoordPath = agentPath(this.extensionPath).join('coordination');
            const effectiveCoordPath = coordinationPath
                ? agentPath(coordinationPath)
                : bundledCoordPath;

            // Copy slash commands
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

            // Copy agent-CLAUDE.md as CLAUDE.md
            const claudeMdSrc = effectiveCoordPath.join('agent-CLAUDE.md').forNodeFs();
            if (fs.existsSync(claudeMdSrc)) {
                fs.copyFileSync(claudeMdSrc, `${worktreeAgentsDir}/CLAUDE.md`);
            }

            // Copy hooks
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

            // Copy hooks.json to .claude/settings.json
            const hooksJsonSrc = effectiveCoordPath.join('hooks.json').forNodeFs();
            if (fs.existsSync(hooksJsonSrc)) {
                const worktreeClaudeDir = worktreePath.join('.claude').forNodeFs();
                fs.mkdirSync(worktreeClaudeDir, { recursive: true });
                fs.copyFileSync(hooksJsonSrc, `${worktreeClaudeDir}/settings.json`);
            }

            // Create status directory
            fs.mkdirSync(`${worktreeAgentsDir}/status`, { recursive: true });

            // Copy from repo's .claude-agents if exists (overrides bundled)
            const repoAgentsDir = repoPath.join('.claude-agents').forNodeFs();
            if (fs.existsSync(repoAgentsDir)) {
                const repoClaimerSrc = `${repoAgentsDir}/task-claimer.sh`;
                if (fs.existsSync(repoClaimerSrc)) {
                    const dest = `${worktreeAgentsDir}/task-claimer.sh`;
                    fs.copyFileSync(repoClaimerSrc, dest);
                    try { fs.chmodSync(dest, 0o755); } catch { /* ignore */ }
                }

                const repoClaudeMdSrc = `${repoAgentsDir}/CLAUDE.md`;
                if (fs.existsSync(repoClaudeMdSrc)) {
                    fs.copyFileSync(repoClaudeMdSrc, `${worktreeAgentsDir}/CLAUDE.md`);
                }
            }

            // Handle backlog symlink
            const backlogPathSetting = config.backlogPath;
            if (backlogPathSetting) {
                const backlogPathObj = agentPath(backlogPathSetting);
                const worktreeBacklogDir = `${worktreeAgentsDir}/backlog`;

                try { fs.unlinkSync(worktreeBacklogDir); } catch { /* ignore */ }
                try { fs.rmdirSync(worktreeBacklogDir, { recursive: true }); } catch { /* ignore */ }

                try {
                    fs.symlinkSync(backlogPathObj.forNodeFs(), worktreeBacklogDir, 'junction');
                } catch {
                    this.copyDirRecursive(backlogPathObj.forNodeFs(), worktreeBacklogDir);
                }
            }

            // Ensure .opus-orchestra is in .gitignore
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
            console.error('[WorktreeManager] Failed to copy coordination files:', error);
        }
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
