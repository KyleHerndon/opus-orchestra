/**
 * StatsBar - Dashboard header showing aggregate statistics
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { DashboardStats } from '../types.js';

interface StatsBarProps {
  stats: DashboardStats;
}

export function StatsBar({ stats }: StatsBarProps): React.ReactElement {
  return (
    <Box borderStyle="single" borderColor="blue" paddingX={1}>
      <Text bold color="blue">Opus Orchestra</Text>
      <Text> </Text>
      <Text dimColor>|</Text>
      <Text> </Text>

      <Text>Agents: </Text>
      <Text color="cyan">{stats.total}</Text>
      <Text> </Text>
      <Text dimColor>|</Text>
      <Text> </Text>

      <Text>Working: </Text>
      <Text color="green">{stats.working}</Text>
      <Text> </Text>
      <Text dimColor>|</Text>
      <Text> </Text>

      <Text>Waiting: </Text>
      <Text color="yellow">{stats.waiting}</Text>
      <Text> </Text>
      <Text dimColor>|</Text>
      <Text> </Text>

      {stats.containerized > 0 && (
        <>
          <Text>Containers: </Text>
          <Text color="magenta">{stats.containerized}</Text>
          <Text> </Text>
          <Text dimColor>|</Text>
          <Text> </Text>
        </>
      )}

      <Text color="green">+{stats.totalInsertions}</Text>
      <Text>/</Text>
      <Text color="red">-{stats.totalDeletions}</Text>
    </Box>
  );
}
