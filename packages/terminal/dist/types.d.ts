/**
 * Types for terminal UI
 */
import type { AgentStatus, DiffStats } from '@opus-orchestra/core';
/**
 * Todo item from Claude Code
 */
export interface TodoItem {
    status: 'pending' | 'in_progress' | 'completed';
    content: string;
    activeForm?: string;
}
/**
 * Agent data for terminal display
 */
export interface TerminalAgent {
    id: number;
    name: string;
    sessionId?: string;
    status: AgentStatus;
    repoPath: string;
    branch: string;
    diffStats: DiffStats;
    containerConfigName?: string;
    containerState?: string;
    pendingApproval?: string | null;
    todos: TodoItem[];
    lastInteractionTime: Date;
}
/**
 * Stats for dashboard header
 */
export interface DashboardStats {
    total: number;
    working: number;
    waiting: number;
    containerized: number;
    totalInsertions: number;
    totalDeletions: number;
}
/**
 * View types for the app
 */
export type ViewType = 'agents' | 'diff' | 'settings' | 'help';
//# sourceMappingURL=types.d.ts.map