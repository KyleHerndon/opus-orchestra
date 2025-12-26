/**
 * VSCode-specific Agent type
 *
 * This extends the core PersistedAgent with VSCode-specific runtime state.
 * The terminal field uses vscode.Terminal instead of TerminalHandle.
 *
 * TODO: Migrate to use TerminalHandle from core and VSCodeTerminalAdapter
 */

import * as vscode from 'vscode';
import {
    PersistedAgent,
    AgentStatus,
    DiffStats,
    ContainerInfo,
} from '@opus-orchestra/core';

/**
 * Runtime agent data (includes volatile state)
 * VSCode-specific: uses vscode.Terminal instead of TerminalHandle
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
