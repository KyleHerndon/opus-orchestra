/**
 * GitService - Git operations abstraction using simple-git
 *
 * Provides all git-related operations with:
 * - Type-safe API via simple-git
 * - Automatic retry with exponential backoff for transient failures
 * - Structured error handling with Result types
 * - Timeout protection for long operations
 *
 * Error handling:
 * - Methods that can fail in expected ways return Result<T>
 * - Callers can distinguish between "no data" and "error getting data"
 */

import simpleGit, { SimpleGit, SimpleGitOptions } from 'simple-git';
import pRetry from 'p-retry';
import { DiffStats } from '../types/agent';
import { Result, ok, err, GitErrorCode } from '../types/result';
import { ILogger } from './Logger';

/**
 * Default timeouts for git operations (in milliseconds)
 */
export const GIT_TIMEOUTS = {
  /** Fast operations like branch listing */
  fast: 5000,
  /** Medium operations like diff stats */
  medium: 15000,
  /** Slow operations like worktree creation */
  slow: 60000,
} as const;

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
 * Git operations service using simple-git
 */
export class GitService implements IGitService {
  private logger?: ILogger;

  constructor(logger?: ILogger) {
    this.logger = logger?.child({ component: 'GitService' });
  }

  /**
   * Create a simple-git instance for a specific directory
   */
  private git(cwd: string, timeout: number = GIT_TIMEOUTS.medium): SimpleGit {
    const options: Partial<SimpleGitOptions> = {
      baseDir: cwd,
      binary: 'git',
      maxConcurrentProcesses: 6,
      timeout: {
        block: timeout,
      },
    };
    return simpleGit(options);
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
      // Use synchronous check via simple-git
      const git = this.git(path, GIT_TIMEOUTS.fast);
      // checkIsRepo is async, so we use a sync approach
      const { execSync } = require('child_process');
      execSync('git rev-parse --git-dir', { cwd: path, stdio: 'ignore' });
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
      const git = this.git(repoPath, GIT_TIMEOUTS.fast);
      const branchSummary = await git.branch();
      return branchSummary.current;
    }, 'getCurrentBranch');
  }

  /**
   * Get the base branch (main or master)
   */
  async getBaseBranch(repoPath: string): Promise<string> {
    try {
      const git = this.git(repoPath, GIT_TIMEOUTS.fast);
      const branchSummary = await git.branch(['-l', 'main', 'master']);

      if (branchSummary.all.includes('main')) {
        return 'main';
      }
      if (branchSummary.all.includes('master')) {
        return 'master';
      }
      return 'HEAD~1';
    } catch {
      return 'HEAD~1';
    }
  }

  /**
   * Get diff statistics between current branch and base
   * Protected with timeout and retry to handle transient failures.
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
        const git = this.git(worktreePath, GIT_TIMEOUTS.medium);
        // Use diffSummary for structured output
        const summary = await git.diffSummary([`${baseBranch}...HEAD`]);
        return {
          filesChanged: summary.changed,
          insertions: summary.insertions,
          deletions: summary.deletions,
        };
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
   * Get list of changed files
   * Protected with timeout and retry.
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
        const git = this.git(worktreePath, GIT_TIMEOUTS.medium);
        const summary = await git.diffSummary([`${baseBranch}...HEAD`]);
        return summary.files.map(f => f.file);
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
   * Protected with timeout and retry (can be slow on large repos)
   */
  async createWorktree(
    repoPath: string,
    branchName: string,
    worktreePath: string,
    baseBranch: string
  ): Promise<void> {
    await this.withRetry(async () => {
      const git = this.git(repoPath, GIT_TIMEOUTS.slow);
      // simple-git doesn't have direct worktree support, use raw command
      await git.raw(['worktree', 'add', '-b', branchName, worktreePath, baseBranch]);
    }, 'createWorktree');
  }

  /**
   * Remove a worktree
   */
  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    try {
      const git = this.git(repoPath, GIT_TIMEOUTS.medium);
      await git.raw(['worktree', 'remove', worktreePath, '--force']);
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
      const git = this.git(repoPath, GIT_TIMEOUTS.fast);
      await git.deleteLocalBranch(branchName, true);
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
      const git = this.git(repoPath, GIT_TIMEOUTS.fast);
      await git.raw(['branch', '-m', oldName, newName]);
    }, 'renameBranch');
  }

  /**
   * Initialize a new git repository
   */
  async initRepo(path: string): Promise<void> {
    const git = this.git(path, GIT_TIMEOUTS.fast);
    await git.init();
  }

  /**
   * Stage all files
   */
  async stageAll(repoPath: string): Promise<void> {
    await this.withRetry(async () => {
      const git = this.git(repoPath, GIT_TIMEOUTS.medium);
      await git.add('-A');
    }, 'stageAll');
  }

  /**
   * Create a commit
   */
  async commit(repoPath: string, message: string): Promise<void> {
    await this.withRetry(async () => {
      const git = this.git(repoPath, GIT_TIMEOUTS.medium);
      await git.commit(message);
    }, 'commit');
  }
}
