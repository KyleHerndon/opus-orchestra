/**
 * GitService - Git operations abstraction using CLI git
 *
 * Provides all git-related operations with:
 * - Cross-platform support via SystemAdapter (uses WSL on Windows)
 * - Automatic retry with exponential backoff for transient failures
 * - Structured error handling with Result types
 *
 * Error handling:
 * - Methods that can fail in expected ways return Result<T>
 * - Callers can distinguish between "no data" and "error getting data"
 */

import pRetry from 'p-retry';
import { DiffStats } from '../types/agent';
import { Result, ok, err, GitErrorCode } from '../types/result';
import { ILogger } from './Logger';
import { SystemAdapter } from '../adapters/SystemAdapter';

/**
 * Retry configuration for git operations
 */
const RETRY_CONFIG = {
  /** Number of retry attempts */
  retries: 3,
  /** Minimum delay between retries in ms */
  minTimeout: 500,
  /** Maximum delay between retries in ms */
  maxTimeout: 3000,
  /** Multiplier for exponential backoff */
  factor: 2,
} as const;

/**
 * Git service interface
 */
export interface IGitService {
  isGitRepo(path: string): boolean;
  getCurrentBranch(repoPath: string): Promise<string>;
  getBaseBranch(repoPath: string): Promise<string>;
  /** @deprecated Use getDiffStatsResult for explicit error handling */
  getDiffStats(worktreePath: string, baseBranch: string): Promise<DiffStats>;
  /** Get diff stats with explicit error handling */
  getDiffStatsResult(worktreePath: string, baseBranch: string): Promise<Result<DiffStats>>;
  /** @deprecated Use getChangedFilesResult for explicit error handling */
  getChangedFiles(worktreePath: string, baseBranch: string): Promise<string[]>;
  /** Get changed files with explicit error handling */
  getChangedFilesResult(worktreePath: string, baseBranch: string): Promise<Result<string[]>>;
  createWorktree(repoPath: string, branchName: string, worktreePath: string, baseBranch: string): Promise<void>;
  removeWorktree(repoPath: string, worktreePath: string): Promise<void>;
  deleteBranch(repoPath: string, branchName: string): Promise<void>;
  renameBranch(repoPath: string, oldName: string, newName: string): Promise<void>;
  initRepo(path: string): Promise<void>;
  stageAll(repoPath: string): Promise<void>;
  commit(repoPath: string, message: string): Promise<void>;
}

/**
 * Git operations service using CLI git via SystemAdapter
 */
export class GitService implements IGitService {
  private logger?: ILogger;
  private system: SystemAdapter;

  constructor(system: SystemAdapter, logger?: ILogger) {
    this.system = system;
    this.logger = logger?.child({ component: 'GitService' });
  }

  /**
   * Execute a git operation with retry logic
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    return pRetry(operation, {
      retries: RETRY_CONFIG.retries,
      minTimeout: RETRY_CONFIG.minTimeout,
      maxTimeout: RETRY_CONFIG.maxTimeout,
      factor: RETRY_CONFIG.factor,
      onFailedAttempt: (context) => {
        const errorMessage = context.error instanceof Error ? context.error.message : String(context.error);
        this.logger?.warn(
          `Git operation '${operationName}' failed (attempt ${context.attemptNumber}/${RETRY_CONFIG.retries + 1}): ${errorMessage}`
        );
      },
    });
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
    return this.withRetry(async () => {
      const result = await this.system.exec('git branch --show-current', repoPath);
      return result.trim();
    }, 'getCurrentBranch');
  }

  /**
   * Get the base branch (main or master)
   */
  async getBaseBranch(repoPath: string): Promise<string> {
    try {
      const result = await this.system.exec('git branch -l main master', repoPath);
      const branches = result.trim().split('\n').map(b => b.replace(/^\*?\s*/, '').trim());

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
   * Protected with retry to handle transient failures.
   * @deprecated Use getDiffStatsResult for explicit error handling
   */
  async getDiffStats(worktreePath: string, baseBranch: string): Promise<DiffStats> {
    const result = await this.getDiffStatsResult(worktreePath, baseBranch);
    if (result.success) {
      return result.data;
    }
    // Backward compatibility: return zeros on error
    return { insertions: 0, deletions: 0, filesChanged: 0 };
  }

  /**
   * Get diff statistics with explicit error handling and retry.
   * Returns Result<DiffStats> so caller can distinguish between "no changes" and "error".
   */
  async getDiffStatsResult(worktreePath: string, baseBranch: string): Promise<Result<DiffStats>> {
    try {
      const stats = await this.withRetry(async () => {
        // Use --shortstat for easy parsing
        const result = await this.system.exec(
          `git diff --shortstat "${baseBranch}...HEAD"`,
          worktreePath
        );
        return this.parseShortstat(result);
      }, 'getDiffStats');

      return ok(stats);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes('timeout') || message.includes('TIMEOUT')) {
        this.logger?.warn(`Git diff timed out: ${message}`);
        return err(`Git diff timed out`, GitErrorCode.TIMEOUT);
      }

      this.logger?.warn({ err: error }, 'Failed to get diff stats');
      return err(message, GitErrorCode.COMMAND_FAILED);
    }
  }

  /**
   * Parse git diff --shortstat output
   * Example: " 3 files changed, 10 insertions(+), 5 deletions(-)"
   */
  private parseShortstat(output: string): DiffStats {
    const stats: DiffStats = { filesChanged: 0, insertions: 0, deletions: 0 };
    const trimmed = output.trim();

    if (!trimmed) {
      return stats;
    }

    // Match patterns like "3 files changed", "10 insertions(+)", "5 deletions(-)"
    const filesMatch = trimmed.match(/(\d+)\s+files?\s+changed/);
    const insertionsMatch = trimmed.match(/(\d+)\s+insertions?\(\+\)/);
    const deletionsMatch = trimmed.match(/(\d+)\s+deletions?\(-\)/);

    if (filesMatch) {
      stats.filesChanged = parseInt(filesMatch[1], 10);
    }
    if (insertionsMatch) {
      stats.insertions = parseInt(insertionsMatch[1], 10);
    }
    if (deletionsMatch) {
      stats.deletions = parseInt(deletionsMatch[1], 10);
    }

    return stats;
  }

  /**
   * Get list of changed files
   * Protected with retry.
   * @deprecated Use getChangedFilesResult for explicit error handling
   */
  async getChangedFiles(worktreePath: string, baseBranch: string): Promise<string[]> {
    const result = await this.getChangedFilesResult(worktreePath, baseBranch);
    if (result.success) {
      return result.data;
    }
    // Backward compatibility: return empty array on error
    return [];
  }

  /**
   * Get list of changed files with explicit error handling and retry.
   * Returns Result<string[]> so caller can distinguish between "no files" and "error".
   */
  async getChangedFilesResult(worktreePath: string, baseBranch: string): Promise<Result<string[]>> {
    try {
      const files = await this.withRetry(async () => {
        const result = await this.system.exec(
          `git diff --name-only "${baseBranch}...HEAD"`,
          worktreePath
        );
        const trimmed = result.trim();
        if (!trimmed) {
          return [];
        }
        return trimmed.split('\n').filter(f => f.length > 0);
      }, 'getChangedFiles');

      return ok(files);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes('timeout') || message.includes('TIMEOUT')) {
        this.logger?.warn(`Git diff --name-only timed out: ${message}`);
        return err(`Git diff timed out`, GitErrorCode.TIMEOUT);
      }

      return err(message, GitErrorCode.COMMAND_FAILED);
    }
  }

  /**
   * Create a new worktree with a new branch
   * Protected with retry (can be slow on large repos)
   */
  async createWorktree(
    repoPath: string,
    branchName: string,
    worktreePath: string,
    baseBranch: string
  ): Promise<void> {
    await this.withRetry(async () => {
      await this.system.exec(
        `git worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`,
        repoPath
      );
    }, 'createWorktree');
  }

  /**
   * Remove a worktree
   */
  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    try {
      await this.system.exec(
        `git worktree remove "${worktreePath}" --force`,
        repoPath
      );
    } catch (error) {
      // Log but don't throw - worktree removal failures are often expected
      this.logger?.debug(`Worktree removal may have partially failed: ${error}`);
    }
  }

  /**
   * Delete a branch
   */
  async deleteBranch(repoPath: string, branchName: string): Promise<void> {
    try {
      await this.system.exec(`git branch -D "${branchName}"`, repoPath);
    } catch (error) {
      // Log but don't throw - branch deletion failures are often expected
      this.logger?.debug(`Branch deletion may have failed: ${error}`);
    }
  }

  /**
   * Rename a branch
   */
  async renameBranch(repoPath: string, oldName: string, newName: string): Promise<void> {
    await this.withRetry(async () => {
      await this.system.exec(`git branch -m "${oldName}" "${newName}"`, repoPath);
    }, 'renameBranch');
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
    await this.withRetry(async () => {
      await this.system.exec('git add -A', repoPath);
    }, 'stageAll');
  }

  /**
   * Create a commit
   */
  async commit(repoPath: string, message: string): Promise<void> {
    await this.withRetry(async () => {
      // Escape double quotes in message
      const escapedMessage = message.replace(/"/g, '\\"');
      await this.system.exec(`git commit -m "${escapedMessage}"`, repoPath);
    }, 'commit');
  }
}
