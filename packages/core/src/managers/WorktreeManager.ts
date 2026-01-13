/**
 * WorktreeManager - Git worktree operations for agents
 *
 * Platform-agnostic implementation using SystemAdapter for all
 * file and command operations.
 */

import { SystemAdapter } from '../adapters/SystemAdapter';
import { ConfigAdapter } from '../adapters/ConfigAdapter';
import { PersistedAgent, Agent } from '../types/agent';
import { PersistedAgentSchema, safeParse, formatZodError } from '../types/schemas';
import { ILogger } from '../services/Logger';
import { atomicWriteJson, safeReadJson, safeStat } from '../utils/safeFs';
// Import coordination path from index to avoid duplication
// Note: This import is safe because getCoordinationPath has no dependencies on managers
import { getCoordinationPath } from '../index';

/**
 * Worktree manager interface
 */
export interface IWorktreeManager {
  worktreeExists(worktreePath: string): boolean;
  createWorktree(repoPath: string, worktreePath: string, branchName: string, baseBranch: string): void;
  removeWorktree(repoPath: string, worktreePath: string, branchName?: string): void;
  renameWorktree(
    repoPath: string,
    oldWorktreePath: string,
    newWorktreePath: string,
    oldBranch: string,
    newBranch: string
  ): void;
  getWorktreePath(repoPath: string, agentName: string): string;
  scanWorktreesForAgents(repoPath: string): PersistedAgent[];
  saveAgentMetadata(agent: Agent): void;
  loadAgentMetadata(worktreePath: string): PersistedAgent | null;
  copyCoordinationFiles(agent: Agent, extensionPath?: string): void;
}

/**
 * WorktreeManager implementation
 */
export class WorktreeManager implements IWorktreeManager {
  private readonly METADATA_DIR = '.opus-orchestra';
  private readonly METADATA_FILE = 'agent.json';

  private system: SystemAdapter;
  private config: ConfigAdapter;
  private logger?: ILogger;

  constructor(system: SystemAdapter, config: ConfigAdapter, logger?: ILogger) {
    this.system = system;
    this.config = config;
    this.logger = logger?.child({ component: 'WorktreeManager' });
  }

  private get worktreeDir(): string {
    return this.config.get('worktreeDirectory');
  }

  /**
   * Check if a worktree exists at the given path
   */
  worktreeExists(worktreePath: string): boolean {
    const fsPath = this.system.convertPath(worktreePath, 'nodeFs');
    return this.system.exists(fsPath);
  }

  /**
   * Create a new git worktree
   */
  createWorktree(repoPath: string, worktreePath: string, branchName: string, baseBranch: string): void {
    this.system.execSync(
      `git worktree add -B "${branchName}" "${worktreePath}" "${baseBranch}"`,
      repoPath
    );
  }

  /**
   * Remove a git worktree and optionally its branch
   */
  removeWorktree(repoPath: string, worktreePath: string, branchName?: string): void {
    // Try git worktree remove first
    this.system.execSilent(`git worktree remove "${worktreePath}" --force`, repoPath);

    // If directory still exists (git worktree remove failed), remove it directly
    const fsPath = this.system.convertPath(worktreePath, 'nodeFs');
    if (this.system.exists(fsPath)) {
      this.logger?.debug(`Worktree dir still exists after git remove, deleting directly: ${fsPath}`);
      this.system.rmdir(fsPath, { recursive: true });
    }

    // Prune any stale worktree references
    this.system.execSilent('git worktree prune', repoPath);

    if (branchName) {
      this.system.execSilent(`git branch -D "${branchName}"`, repoPath);
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
    this.system.execSilent(`git worktree remove "${oldWorktreePath}" --force`, repoPath);

    // Rename branch
    this.system.execSync(`git branch -m "${oldBranch}" "${newBranch}"`, repoPath);

    // Create new worktree with renamed branch
    this.system.execSync(`git worktree add "${newWorktreePath}" "${newBranch}"`, repoPath);
  }

  /**
   * Get the worktree path for an agent
   */
  getWorktreePath(repoPath: string, agentName: string): string {
    const repoTerminalPath = this.system.convertPath(repoPath, 'terminal');
    return `${repoTerminalPath}/${this.worktreeDir}/claude-${agentName}`.replace(/\\/g, '/');
  }

  /**
   * Scan worktrees directory for existing agents
   * Uses safe operations to handle race conditions during scanning
   */
  scanWorktreesForAgents(repoPath: string): PersistedAgent[] {
    const agents: PersistedAgent[] = [];
    const repoTerminalPath = this.system.convertPath(repoPath, 'terminal');
    const worktreesDir = this.system.convertPath(
      `${repoTerminalPath}/${this.worktreeDir}`,
      'nodeFs'
    );

    this.logger?.debug(`Scanning worktrees directory: ${worktreesDir}`);

    if (!this.system.exists(worktreesDir)) {
      this.logger?.debug(`Worktrees directory does not exist`);
      return agents;
    }

    try {
      const entries = this.system.readDir(worktreesDir);

      for (const entry of entries) {
        // Only look at directories that look like agent worktrees
        if (!entry.startsWith('claude-') && !entry.startsWith('agent-')) {
          continue;
        }

        // Use safe stat - handles race condition if dir deleted during scan
        const entryPath = this.system.joinPath(worktreesDir, entry);
        const stat = safeStat(this.system, entryPath);
        if (!stat || !stat.isDirectory()) {
          continue;
        }

        const worktreePath = `${repoTerminalPath}/${this.worktreeDir}/${entry}`;
        const metadata = this.loadAgentMetadata(worktreePath);

        if (metadata) {
          metadata.worktreePath = worktreePath;
          metadata.repoPath = repoPath;
          agents.push(metadata);
          this.logger?.debug(`Found agent in worktree: ${entry}`);
        }
      }
    } catch (error) {
      // Log at WARN level since this could indicate a real problem with agent discovery
      this.logger?.warn(`Failed to scan worktrees in ${repoPath}: ${error}`);
    }

    return agents;
  }

  /**
   * Save agent metadata to worktree
   * Uses atomic write to prevent corruption from partial writes
   */
  saveAgentMetadata(agent: Agent): void {
    try {
      const worktreeFsPath = this.system.convertPath(agent.worktreePath, 'nodeFs');
      const metadataDir = this.system.joinPath(worktreeFsPath, this.METADATA_DIR);
      const metadataFile = this.system.joinPath(metadataDir, this.METADATA_FILE);

      this.system.mkdir(metadataDir);

      const metadata: PersistedAgent = {
        id: agent.id,
        name: agent.name,
        sessionId: agent.sessionId,
        branch: agent.branch,
        worktreePath: agent.worktreePath,
        repoPath: agent.repoPath,
        taskFile: agent.taskFile,
        containerConfigName: agent.containerConfigName,
        sessionStarted: agent.sessionStarted,
      };

      // Use atomic write to prevent corruption
      atomicWriteJson(this.system, metadataFile, metadata);
      this.logger?.debug(`Saved agent metadata to ${metadataFile}`);
    } catch (error) {
      this.logger?.debug(`Failed to save agent metadata: ${error}`);
    }
  }

  /**
   * Load agent metadata from worktree.
   * Uses Zod schema validation for robust error handling.
   * Uses safe read to handle missing/corrupt files gracefully.
   */
  loadAgentMetadata(worktreePath: string): PersistedAgent | null {
    const wtFsPath = this.system.convertPath(worktreePath, 'nodeFs');
    const metadataFile = this.system.joinPath(wtFsPath, this.METADATA_DIR, this.METADATA_FILE);

    // Use safe read - returns null if file doesn't exist or is invalid JSON
    const rawData = safeReadJson<unknown>(this.system, metadataFile);
    if (rawData === null) {
      return null;
    }

    // Validate with Zod schema
    const metadata = safeParse(
      PersistedAgentSchema,
      rawData,
      (error) => {
        this.logger?.warn(`Invalid agent metadata in ${metadataFile}: ${formatZodError(error)}`);
      }
    );

    if (metadata === null) {
      return null;
    }

    this.logger?.debug(`Loaded agent metadata from ${metadataFile}`);
    return metadata;
  }

  /**
   * Copy coordination files to a worktree.
   * Uses bundled coordination files from @opus-orchestra/core by default.
   * @param agent - The agent to copy files for
   * @param extensionPath - Optional path to extension/package root (uses core's bundled files if not provided)
   */
  copyCoordinationFiles(agent: Agent, extensionPath?: string): void {
    const coordinationPath = this.config.get('coordinationScriptsPath');

    try {
      const worktreeFsPath = this.system.convertPath(agent.worktreePath, 'nodeFs');
      const repoFsPath = this.system.convertPath(agent.repoPath, 'nodeFs');

      // Create directories
      const worktreeCommandsDir = this.system.joinPath(worktreeFsPath, '.claude', 'commands');
      const worktreeAgentsDir = this.system.joinPath(worktreeFsPath, '.opus-orchestra');
      this.system.mkdir(worktreeCommandsDir);
      this.system.mkdir(worktreeAgentsDir);

      // Determine coordination source:
      // 1. User-configured path (highest priority)
      // 2. Extension-provided path (for VSCode extension backwards compat)
      // 3. Core's bundled coordination files (default)
      let effectiveCoordPath: string;
      if (coordinationPath) {
        effectiveCoordPath = this.system.convertPath(coordinationPath, 'nodeFs');
      } else if (extensionPath) {
        effectiveCoordPath = this.system.joinPath(
          this.system.convertPath(extensionPath, 'nodeFs'),
          'coordination'
        );
      } else {
        effectiveCoordPath = getCoordinationPath();
      }

      // Copy slash commands
      const commandsSrcDir = this.system.joinPath(effectiveCoordPath, 'commands');
      if (this.system.exists(commandsSrcDir)) {
        const commands = this.system.readDir(commandsSrcDir);
        for (const cmd of commands) {
          this.system.copyFile(
            this.system.joinPath(commandsSrcDir, cmd),
            this.system.joinPath(worktreeCommandsDir, cmd)
          );
        }
      }

      // Copy task-claimer.sh
      const claimerSrc = this.system.joinPath(effectiveCoordPath, 'task-claimer.sh');
      if (this.system.exists(claimerSrc)) {
        const dest = this.system.joinPath(worktreeAgentsDir, 'task-claimer.sh');
        this.system.copyFile(claimerSrc, dest);
        this.system.chmod(dest, 0o755);
      }

      // Copy agent-CLAUDE.md as CLAUDE.md
      const claudeMdSrc = this.system.joinPath(effectiveCoordPath, 'agent-CLAUDE.md');
      if (this.system.exists(claudeMdSrc)) {
        this.system.copyFile(
          claudeMdSrc,
          this.system.joinPath(worktreeAgentsDir, 'CLAUDE.md')
        );
      }

      // Copy hooks
      const hooksSrcDir = this.system.joinPath(effectiveCoordPath, 'hooks');
      if (this.system.exists(hooksSrcDir)) {
        const worktreeHooksDir = this.system.joinPath(worktreeAgentsDir, 'hooks');
        this.system.mkdir(worktreeHooksDir);
        const hooks = this.system.readDir(hooksSrcDir);
        for (const hook of hooks) {
          const src = this.system.joinPath(hooksSrcDir, hook);
          const dest = this.system.joinPath(worktreeHooksDir, hook);
          this.system.copyFile(src, dest);
          this.system.chmod(dest, 0o755);
        }
      }

      // Copy hooks.json to .claude/settings.json
      const hooksJsonSrc = this.system.joinPath(effectiveCoordPath, 'hooks.json');
      if (this.system.exists(hooksJsonSrc)) {
        const worktreeClaudeDir = this.system.joinPath(worktreeFsPath, '.claude');
        this.system.mkdir(worktreeClaudeDir);
        this.system.copyFile(
          hooksJsonSrc,
          this.system.joinPath(worktreeClaudeDir, 'settings.json')
        );
      }

      // Create status directory
      this.system.mkdir(this.system.joinPath(worktreeAgentsDir, 'status'));

      // Copy from repo's .opus-orchestra if exists (overrides bundled)
      const repoAgentsDir = this.system.joinPath(repoFsPath, '.opus-orchestra');
      if (this.system.exists(repoAgentsDir)) {
        const repoClaimerSrc = this.system.joinPath(repoAgentsDir, 'task-claimer.sh');
        if (this.system.exists(repoClaimerSrc)) {
          const dest = this.system.joinPath(worktreeAgentsDir, 'task-claimer.sh');
          this.system.copyFile(repoClaimerSrc, dest);
          this.system.chmod(dest, 0o755);
        }

        const repoClaudeMdSrc = this.system.joinPath(repoAgentsDir, 'CLAUDE.md');
        if (this.system.exists(repoClaudeMdSrc)) {
          this.system.copyFile(
            repoClaudeMdSrc,
            this.system.joinPath(worktreeAgentsDir, 'CLAUDE.md')
          );
        }
      }

      // Handle backlog symlink
      const backlogPathSetting = this.config.get('backlogPath');
      if (backlogPathSetting) {
        const backlogFsPath = this.system.convertPath(backlogPathSetting, 'nodeFs');
        const worktreeBacklogDir = this.system.joinPath(worktreeAgentsDir, 'backlog');

        // Remove existing backlog dir/link
        if (this.system.exists(worktreeBacklogDir)) {
          this.system.rmdir(worktreeBacklogDir, { recursive: true });
        }

        // Try symlink, fall back to copy (symlinks may fail on Windows without admin)
        try {
          this.system.symlink(backlogFsPath, worktreeBacklogDir);
        } catch (err) {
          this.logger?.debug(`Symlink failed for backlog (falling back to copy): ${err instanceof Error ? err.message : String(err)}`);
          this.copyDirRecursive(backlogFsPath, worktreeBacklogDir);
        }
      }

      // Ensure .opus-orchestra is in .gitignore
      const gitignorePath = this.system.joinPath(worktreeFsPath, '.gitignore');
      let gitignoreContent = '';
      if (this.system.exists(gitignorePath)) {
        gitignoreContent = this.system.readFile(gitignorePath);
      }
      if (!gitignoreContent.includes('.opus-orchestra')) {
        const newLine = gitignoreContent.length > 0 && !gitignoreContent.endsWith('\n') ? '\n' : '';
        this.system.writeFile(gitignorePath, gitignoreContent + newLine + '.opus-orchestra/\n');
      }
    } catch (error) {
      this.logger?.error({ err: error instanceof Error ? error : undefined }, 'Failed to copy coordination files');
    }
  }

  private copyDirRecursive(src: string, dest: string): void {
    this.system.mkdir(dest);
    const entries = this.system.readDir(src);

    for (const entry of entries) {
      const srcPath = this.system.joinPath(src, entry);
      const destPath = this.system.joinPath(dest, entry);

      try {
        if (this.system.stat(srcPath).isDirectory()) {
          this.copyDirRecursive(srcPath, destPath);
        } else {
          this.system.copyFile(srcPath, destPath);
        }
      } catch (err) {
        // Log at debug level - inaccessible files during copy are usually non-critical
        this.logger?.debug(`Skipping inaccessible file during copy: ${srcPath} - ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
