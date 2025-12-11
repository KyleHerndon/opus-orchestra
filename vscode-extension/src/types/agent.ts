/**
 * Agent-related types, interfaces, and constants
 */

import * as vscode from 'vscode';
import { ContainerInfo, IsolationTier } from './container';

// ============================================================================
// Types
// ============================================================================

/**
 * Agent lifecycle status
 */
export type AgentStatus =
    | 'idle'              // Not running
    | 'working'           // Actively processing
    | 'waiting-input'     // Waiting for user input
    | 'waiting-approval'  // Waiting for permission approval
    | 'stopped'           // Stopped by user or error
    | 'error';            // Error state

/**
 * Git diff statistics
 */
export interface DiffStats {
    insertions: number;
    deletions: number;
    filesChanged: number;
}

/**
 * Persisted agent data (saved to workspace state)
 */
export interface PersistedAgent {
    id: number;
    name: string;
    sessionId: string;
    branch: string;
    worktreePath: string;
    repoPath: string;
    taskFile: string | null;
    isolationTier?: IsolationTier;
}

/**
 * Runtime agent data (includes volatile state)
 */
export interface Agent extends PersistedAgent {
    terminal: vscode.Terminal | null;
    status: AgentStatus;
    statusIcon: string;
    pendingApproval: string | null;
    lastInteractionTime: Date;
    diffStats: DiffStats;
    containerInfo?: ContainerInfo;
}

/**
 * Pending approval request
 */
export interface PendingApproval {
    agentId: number;
    description: string;
    timestamp: Date;
}

/**
 * Agent data for webview display
 */
export interface AgentDisplayData {
    id: number;
    name: string;
    status: AgentStatus;
    statusIcon: string;
    branch: string;
    taskFile: string | null;
    pendingApproval: string | null;
    diffStats: DiffStats;
    hasTerminal: boolean;
    isolationTier?: IsolationTier;
    containerState?: string;
    memoryUsageMB?: number;
    cpuPercent?: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * NATO phonetic alphabet for agent naming
 */
export const AGENT_NAMES = [
    'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
    'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa',
    'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey',
    'xray', 'yankee', 'zulu'
] as const;

/**
 * Status icon mapping
 */
export const STATUS_ICONS: Record<AgentStatus, string> = {
    'idle': 'circle-outline',
    'working': 'sync~spin',
    'waiting-input': 'bell',
    'waiting-approval': 'question',
    'stopped': 'debug-stop',
    'error': 'error',
};

/**
 * Storage key for persisted agents
 */
export const AGENTS_STORAGE_KEY = (workspaceRoot: string) => `claudeAgents.agents.${workspaceRoot}`;
