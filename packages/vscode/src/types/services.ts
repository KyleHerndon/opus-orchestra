/**
 * VSCode-specific service interfaces
 *
 * These interfaces use vscode.Terminal and other VSCode-specific types.
 * Core service interfaces are in @opus-orchestra/core.
 */

import { DiffStats, ParsedStatus } from '@opus-orchestra/core';

/**
 * Git operations service interface
 */
export interface IGitService {
    isGitRepo(path: string): boolean;
    getCurrentBranch(repoPath: string): Promise<string>;
    getBaseBranch(repoPath: string): Promise<string>;
    getDiffStats(worktreePath: string, baseBranch: string): Promise<DiffStats>;
    createWorktree(repoPath: string, branchName: string, worktreePath: string, baseBranch: string): Promise<void>;
    removeWorktree(repoPath: string, worktreePath: string): Promise<void>;
    deleteBranch(repoPath: string, branchName: string): Promise<void>;
    renameBranch(repoPath: string, oldName: string, newName: string): Promise<void>;
}

/**
 * Status/hook parsing service interface
 */
export interface IStatusService {
    checkStatus(worktreePath: string): ParsedStatus | null;
    parseHookData(content: string): ParsedStatus | null;
    getStatusDirectory(worktreePath: string): string;
}

/**
 * Command execution service interface
 */
export interface ICommandService {
    exec(command: string, cwd: string): string;
    execAsync(command: string, cwd: string): Promise<string>;
    execSilent(command: string, cwd: string): void;
}

/**
 * Logger service interface
 */
export interface ILogger {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, error?: Error, ...args: unknown[]): void;
}
