/**
 * GitService - Git operations abstraction
 *
 * Provides all git-related operations used by the extension.
 */

import { DiffStats, IGitService } from '../types';
import { CommandService, getCommandService } from './CommandService';
import { getLogger, isLoggerInitialized } from './Logger';

/**
 * Git operations service
 */
export class GitService implements IGitService {
    private commandService: CommandService;

    constructor(commandService?: CommandService) {
        this.commandService = commandService ?? getCommandService();
    }

    /**
     * Check if a directory is a git repository
     */
    isGitRepo(path: string): boolean {
        try {
            this.commandService.exec('git rev-parse --git-dir', path);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get the current branch name
     */
    async getCurrentBranch(repoPath: string): Promise<string> {
        const output = await this.commandService.execAsync('git branch --show-current', repoPath);
        return output.trim();
    }

    /**
     * Get the base branch (main or master)
     */
    async getBaseBranch(repoPath: string): Promise<string> {
        try {
            const branches = await this.commandService.execAsync('git branch -l main master', repoPath);

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

    /**
     * Get diff statistics between current branch and base
     */
    async getDiffStats(worktreePath: string, baseBranch: string): Promise<DiffStats> {
        try {
            const output = await this.commandService.execAsync(
                `git diff --shortstat ${baseBranch}...HEAD`,
                worktreePath
            );

            if (!output.trim()) {
                return { insertions: 0, deletions: 0, filesChanged: 0 };
            }

            const filesMatch = output.match(/(\d+) files? changed/);
            const insertMatch = output.match(/(\d+) insertions?\(\+\)/);
            const deleteMatch = output.match(/(\d+) deletions?\(-\)/);

            return {
                filesChanged: filesMatch ? parseInt(filesMatch[1]) : 0,
                insertions: insertMatch ? parseInt(insertMatch[1]) : 0,
                deletions: deleteMatch ? parseInt(deleteMatch[1]) : 0,
            };
        } catch (error) {
            if (isLoggerInitialized()) {
                getLogger().child('GitService').warn('Failed to get diff stats', error);
            }
            return { insertions: 0, deletions: 0, filesChanged: 0 };
        }
    }

    /**
     * Get list of changed files
     */
    async getChangedFiles(worktreePath: string, baseBranch: string): Promise<string[]> {
        try {
            const output = await this.commandService.execAsync(
                `git diff --name-only ${baseBranch}...HEAD`,
                worktreePath
            );
            return output.trim().split('\n').filter(f => f);
        } catch {
            return [];
        }
    }

    /**
     * Create a new worktree with a new branch
     */
    async createWorktree(
        repoPath: string,
        branchName: string,
        worktreePath: string,
        baseBranch: string
    ): Promise<void> {
        await this.commandService.execAsync(
            `git worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`,
            repoPath
        );
    }

    /**
     * Remove a worktree
     */
    async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
        this.commandService.execSilent(`git worktree remove "${worktreePath}" --force`, repoPath);
    }

    /**
     * Delete a branch
     */
    async deleteBranch(repoPath: string, branchName: string): Promise<void> {
        this.commandService.execSilent(`git branch -D "${branchName}"`, repoPath);
    }

    /**
     * Rename a branch
     */
    async renameBranch(repoPath: string, oldName: string, newName: string): Promise<void> {
        await this.commandService.execAsync(
            `git branch -m "${oldName}" "${newName}"`,
            repoPath
        );
    }

    /**
     * Initialize a new git repository
     */
    async initRepo(path: string): Promise<void> {
        await this.commandService.execAsync('git init', path);
    }

    /**
     * Stage all files
     */
    async stageAll(repoPath: string): Promise<void> {
        await this.commandService.execAsync('git add -A', repoPath);
    }

    /**
     * Create a commit
     */
    async commit(repoPath: string, message: string): Promise<void> {
        await this.commandService.execAsync(`git commit -m "${message}"`, repoPath);
    }
}

/**
 * Singleton instance
 */
let gitServiceInstance: GitService | null = null;

/**
 * Get the global GitService instance
 */
export function getGitService(): GitService {
    if (!gitServiceInstance) {
        gitServiceInstance = new GitService();
    }
    return gitServiceInstance;
}

/**
 * Reset the global GitService instance (for testing)
 */
export function resetGitService(): void {
    gitServiceInstance = null;
}
