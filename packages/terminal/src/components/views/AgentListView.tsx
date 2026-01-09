/**
 * AgentListView - Main agent list view
 *
 * Displays stats bar, agent list with navigation, and help bar.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { StatsBar } from '../StatsBar.js';
import { AgentRow } from '../AgentRow.js';
import type { TerminalAgent, DashboardStats } from '../../types.js';

interface AgentListViewProps {
  agents: TerminalAgent[];
  stats: DashboardStats;
  selectedIndex: number;
  expandedIds: Set<number>;
  onApprove?: (agentId: number) => void;
  onReject?: (agentId: number) => void;
}

export function AgentListView({
  agents,
  stats,
  selectedIndex,
  expandedIds,
  onApprove,
  onReject,
}: AgentListViewProps): React.ReactElement {
  if (agents.length === 0) {
    return (
      <Box flexDirection="column">
        <StatsBar stats={stats} />
        <Box marginY={1} flexDirection="column">
          <Text color="yellow">No agents found.</Text>
          <Text dimColor>Press </Text>
          <Text color="cyan">c</Text>
          <Text dimColor> to create agents, or run from a git repository.</Text>
        </Box>
      </Box>
    );
  }

  // Group agents by repo
  const agentsByRepo = new Map<string, TerminalAgent[]>();
  for (const agent of agents) {
    const repoAgents = agentsByRepo.get(agent.repoPath) || [];
    repoAgents.push(agent);
    agentsByRepo.set(agent.repoPath, repoAgents);
  }

  // Calculate global index for selection
  let globalIndex = 0;

  return (
    <Box flexDirection="column">
      <StatsBar stats={stats} />

      {Array.from(agentsByRepo.entries()).map(([repoPath, repoAgents]) => (
        <Box key={repoPath} flexDirection="column" marginTop={1}>
          {/* Repo header (only show if multiple repos) */}
          {agentsByRepo.size > 1 && (
            <Box>
              <Text dimColor>─ </Text>
              <Text color="blue">{repoPath}</Text>
              <Text dimColor> ─</Text>
            </Box>
          )}

          {/* Agent rows */}
          {repoAgents.map((agent) => {
            const isSelected = globalIndex === selectedIndex;
            const isExpanded = expandedIds.has(agent.id);
            globalIndex++;

            return (
              <AgentRow
                key={agent.id}
                agent={agent}
                selected={isSelected}
                expanded={isExpanded}
                onApprove={onApprove ? () => onApprove(agent.id) : undefined}
                onReject={onReject ? () => onReject(agent.id) : undefined}
              />
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
