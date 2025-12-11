/**
 * Configuration types and defaults
 */

import { IsolationTier } from './container';
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
    claudeCommand: string;

    // Directory settings
    worktreeDirectory: string;
    coordinationScriptsPath: string;
    backlogPath: string;
    repositoryPaths: string[];

    // Terminal settings
    terminalType: TerminalType;

    // Polling intervals (ms)
    statusPollingInterval: number;
    diffPollingInterval: number;

    // Isolation settings
    isolationTier: IsolationTier;
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
    claudeCommand: 'claude',
    worktreeDirectory: '.worktrees',
    coordinationScriptsPath: '',
    backlogPath: '',
    repositoryPaths: [],
    terminalType: 'wsl',
    statusPollingInterval: 1000,
    diffPollingInterval: 60000,
    isolationTier: 'standard',
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
