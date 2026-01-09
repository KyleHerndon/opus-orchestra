/**
 * AgentListView - Main agent list view
 *
 * Displays stats bar, agent list with navigation, and help bar.
 */
import React from 'react';
import type { TerminalAgent, DashboardStats } from '../../types.js';
interface AgentListViewProps {
    agents: TerminalAgent[];
    stats: DashboardStats;
    selectedIndex: number;
    expandedIds: Set<number>;
    onApprove?: (agentId: number) => void;
    onReject?: (agentId: number) => void;
}
export declare function AgentListView({ agents, stats, selectedIndex, expandedIds, onApprove, onReject, }: AgentListViewProps): React.ReactElement;
export {};
//# sourceMappingURL=AgentListView.d.ts.map