/**
 * Terminal-related types and constants
 */

import * as vscode from 'vscode';

// ============================================================================
// Types
// ============================================================================

/**
 * Terminal environment type
 */
export type TerminalType =
    | 'wsl'        // Windows Subsystem for Linux
    | 'powershell' // PowerShell
    | 'cmd'        // Command Prompt
    | 'gitbash'    // Git Bash
    | 'bash';      // Native Bash (macOS/Linux)

/**
 * Terminal creation options
 */
export interface TerminalOptions {
    name: string;
    cwd: string;
    iconPath?: vscode.ThemeIcon;
    env?: Record<string, string>;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Terminal startup delays (in ms)
 */
export const TERMINAL_DELAYS = {
    standard: 1000,
    containerized: 2000,
} as const;

/**
 * Git Bash executable path on Windows
 */
export const GIT_BASH_PATH = 'C:\\Program Files\\Git\\bin\\bash.exe';
