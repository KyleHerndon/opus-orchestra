/**
 * GitService - Git operations abstraction
 *
 * Provides all git-related operations.
 * Uses SystemAdapter for command execution - no OS-specific code.
 */

import { SystemAdapter } from '../adapters/SystemAdapter';
import { DiffStats } from '../types/agent';
import { ILogger } from './Logger';

/**
 * Git service interface
 */
export interface IGitService {
  isGitRepo(path: string): boolean;
  getCurrentBranch(repoPath: string): Promise<string>;
  getBaseBranch(repoPath: string): Promise<string>;
  getDiffStats(worktreePath: string, baseBranch: string): Promise<DiffStats>;
  getChangedFiles(worktreePath: string, baseBranch: string): Promise<string[]>;
  createWorktree(repoPath: string, branchName: string, worktreePath: string, baseBranch: string): Promise<void>;
  removeWorktree(repoPath: string, worktreePath: string): Promise<void>;
  deleteBranch(repoPath: string, branchName: string): Promise<void>;
  renameBranch(repoPath: string, oldName: string, newName: string): Promise<void>;
  initRepo(path: string): Promise<void>;
  stageAll(repoPath: string): Promise<void>;
  commit(repoPath: string, message: string): Promise<void>;
}

/**
 * Git operations service
 */
export class GitService implements IGitService {
  private system: SystemAdapter;
  private logger?: ILogger;

  constructor(system: SystemAdapter, logger?: ILogger) {
    this.system = system;
    this.logger = logger?.child('GitService');
  }

  /**
   * Check if a directory is a git repository
   */
  isGitRepo(path: string): boolean {
    try {
      this.system.execSync('git rev-parse --git-dir', path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current branch name
   */
  async getCurrentBranch(repoPath: string): Promise<string> {
    const output = await this.system.exec('git branch --show-current', repoPath);
    return output.trim();
  }

  /**
   * Get the base branch (main or master)
   */
  async getBaseBranch(repoPath: string): Promise<string> {
    try {
      const branches = await this.system.exec('git branch -l main master', repoPath);

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
      const output = await this.system.exec(
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
      this.logger?.warn('Failed to get diff stats', error);
      return { insertions: 0, deletions: 0, filesChanged: 0 };
    }
  }

  /**
   * Get list of changed files
   */
  async getChangedFiles(worktreePath: string, baseBranch: string): Promise<string[]> {
    try {
      const output = await this.system.exec(
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
    await this.system.exec(
      `git worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`,
      repoPath
    );
  }

  /**
   * Remove a worktree
   */
  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    this.system.execSilent(`git worktree remove "${worktreePath}" --force`, repoPath);
  }

  /**
   * Delete a branch
   */
  async deleteBranch(repoPath: string, branchName: string): Promise<void> {
    this.system.execSilent(`git branch -D "${branchName}"`, repoPath);
  }

  /**
   * Rename a branch
   */
  async renameBranch(repoPath: string, oldName: string, newName: string): Promise<void> {
    await this.system.exec(
      `git branch -m "${oldName}" "${newName}"`,
      repoPath
    );
  }

  /**
   * Initialize a new git repository
   */
  async initRepo(path: string): Promise<void> {
    await this.system.exec('git init', path);
  }

  /**
   * Stage all files
   */
  async stageAll(repoPath: string): Promise<void> {
    await this.system.exec('git add -A', repoPath);
  }

  /**
   * Create a commit
   */
  async commit(repoPath: string, message: string): Promise<void> {
    await this.system.exec(`git commit -m "${message}"`, repoPath);
  }
}
