/**
 * Service interfaces for dependency injection
 */

import * as vscode from 'vscode';
import { DiffStats } from './agent';
import { ContainerConfig, ContainerInfo, IsolationTier } from './container';
import { TerminalOptions } from './terminal';
import { ParsedStatus } from './hooks';

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
 * Terminal management service interface
 */
export interface ITerminalService {
    createTerminal(options: TerminalOptions): vscode.Terminal;
    sendText(terminal: vscode.Terminal, text: string): void;
    dispose(terminal: vscode.Terminal): void;
    findTerminalByName(name: string): vscode.Terminal | undefined;
    isTerminalAlive(terminal: vscode.Terminal): boolean;
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
 * Container management service interface
 */
export interface IContainerService {
    getAvailableTiers(): Promise<IsolationTier[]>;
    createContainer(agentId: number, worktreePath: string, tier: IsolationTier, config?: ContainerConfig): Promise<ContainerInfo>;
    removeContainer(agentId: number): Promise<void>;
    getContainer(agentId: number): ContainerInfo | undefined;
    execInContainer(agentId: number, command: string): Promise<string>;
    getContainerStats(agentId: number): Promise<{ memoryMB: number; cpuPercent: number } | null>;
}

/**
 * File system service interface
 */
export interface IFileService {
    exists(path: string): boolean;
    readFile(path: string): string;
    writeFile(path: string, content: string): void;
    readDir(path: string): string[];
    mkdir(path: string): void;
    copyFile(src: string, dest: string): void;
    copyDirRecursive(src: string, dest: string): void;
    symlink(target: string, path: string): void;
    stat(path: string): { mtimeMs: number };
    chmod(path: string, mode: number): void;
    unlink(path: string): void;
    rmdir(path: string): void;
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
