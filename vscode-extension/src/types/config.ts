/**
 * Configuration types and defaults
 */

import { TerminalType } from './terminal';

// ============================================================================
// Types
// ============================================================================

/**
 * Extension configuration schema
 */
export interface ExtensionConfig {
    // Agent settings
    defaultAgentCount: number;
    autoStartClaude: boolean;
    autoStartClaudeOnFocus: boolean;
    claudeCommand: string;

    // Tmux settings
    useTmux: boolean;
    tmuxSessionPrefix: string;

    // Directory settings
    worktreeDirectory: string;
    coordinationScriptsPath: string;
    backlogPath: string;
    repositoryPaths: string[];

    // Terminal settings
    terminalType: TerminalType;

    // Polling intervals (ms)
    diffPollingInterval: number;

    // Container settings (legacy - for reference, these are in package.json)
    containerImage: string;
    containerMemoryLimit: string;
    containerCpuLimit: string;
    firecrackerPath: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: ExtensionConfig = {
    defaultAgentCount: 3,
    autoStartClaude: true,
    autoStartClaudeOnFocus: true,
    claudeCommand: 'claude',
    useTmux: true,
    tmuxSessionPrefix: 'opus',
    worktreeDirectory: '.worktrees',
    coordinationScriptsPath: '',
    backlogPath: '',
    repositoryPaths: [],
    terminalType: 'wsl',
    diffPollingInterval: 60000,
    containerImage: 'ghcr.io/kyleherndon/opus-orchestra-sandbox:latest',
    containerMemoryLimit: '4g',
    containerCpuLimit: '2',
    firecrackerPath: '',
};

/**
 * Polling interval defaults (in ms)
 */
export const POLLING_DEFAULTS = {
    status: 1000,
    diff: 60000,
} as const;

/**
 * VS Code configuration section name
 */
export const CONFIG_SECTION = 'claudeAgents';
