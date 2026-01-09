/**
 * StatusBadge - Colored status indicator
 */

import React from 'react';
import { Text } from 'ink';
import type { AgentStatus } from '@opus-orchestra/core';

interface StatusBadgeProps {
  status: AgentStatus;
}

const STATUS_COLORS: Record<AgentStatus, string> = {
  'idle': 'gray',
  'working': 'green',
  'waiting-input': 'yellow',
  'waiting-approval': 'yellow',
  'stopped': 'red',
  'error': 'red',
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  'idle': 'IDLE',
  'working': 'WORKING',
  'waiting-input': 'WAITING-INPUT',
  'waiting-approval': 'WAITING-APPROVAL',
  'stopped': 'STOPPED',
  'error': 'ERROR',
};

export function StatusBadge({ status }: StatusBadgeProps): React.ReactElement {
  const color = STATUS_COLORS[status] || 'gray';
  const label = STATUS_LABELS[status] || status.toUpperCase();

  return (
    <Text color={color}>{label}</Text>
  );
}
