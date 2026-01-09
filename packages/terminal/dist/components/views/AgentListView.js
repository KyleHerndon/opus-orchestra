import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { StatsBar } from '../StatsBar.js';
import { AgentRow } from '../AgentRow.js';
export function AgentListView({ agents, stats, selectedIndex, expandedIds, onApprove, onReject, }) {
    if (agents.length === 0) {
        return (_jsxs(Box, { flexDirection: "column", children: [_jsx(StatsBar, { stats: stats }), _jsxs(Box, { marginY: 1, flexDirection: "column", children: [_jsx(Text, { color: "yellow", children: "No agents found." }), _jsx(Text, { dimColor: true, children: "Press " }), _jsx(Text, { color: "cyan", children: "c" }), _jsx(Text, { dimColor: true, children: " to create agents, or run from a git repository." })] })] }));
    }
    // Group agents by repo
    const agentsByRepo = new Map();
    for (const agent of agents) {
        const repoAgents = agentsByRepo.get(agent.repoPath) || [];
        repoAgents.push(agent);
        agentsByRepo.set(agent.repoPath, repoAgents);
    }
    // Calculate global index for selection
    let globalIndex = 0;
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(StatsBar, { stats: stats }), Array.from(agentsByRepo.entries()).map(([repoPath, repoAgents]) => (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [agentsByRepo.size > 1 && (_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "\u2500 " }), _jsx(Text, { color: "blue", children: repoPath }), _jsx(Text, { dimColor: true, children: " \u2500" })] })), repoAgents.map((agent) => {
                        const isSelected = globalIndex === selectedIndex;
                        const isExpanded = expandedIds.has(agent.id);
                        globalIndex++;
                        return (_jsx(AgentRow, { agent: agent, selected: isSelected, expanded: isExpanded, onApprove: onApprove ? () => onApprove(agent.id) : undefined, onReject: onReject ? () => onReject(agent.id) : undefined }, agent.id));
                    })] }, repoPath)))] }));
}
//# sourceMappingURL=AgentListView.js.map