/**
 * useAgents - Hook for managing agent state
 *
 * Provides agent data and actions for the terminal UI.
 * Uses ServiceContainer when initialized, falls back to mock data for development.
 * Polling is handled by core's AgentStatusTracker.
 */
import type { TerminalAgent, DashboardStats } from '../types.js';
export interface UseAgentsResult {
    agents: TerminalAgent[];
    stats: DashboardStats;
    loading: boolean;
    error: string | null;
    refreshAgents: () => Promise<void>;
    approveAgent: (agentId: number) => Promise<void>;
    rejectAgent: (agentId: number) => Promise<void>;
    deleteAgent: (agentId: number) => Promise<void>;
    createAgents: (count: number, repoPath?: string) => Promise<void>;
    focusAgent: (agentId: number) => void;
}
export declare function useAgents(): UseAgentsResult;
//# sourceMappingURL=useAgents.d.ts.map