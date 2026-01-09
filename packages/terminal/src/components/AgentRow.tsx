/**
 * AgentRow - Single agent row display (expandable)
 *
 * Displays agent info on a single line with optional expansion
 * for todos and approval prompts.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { StatusBadge } from './StatusBadge.js';
import { TodoList } from './TodoList.js';
import { ApprovalPrompt } from './ApprovalPrompt.js';
import type { TerminalAgent } from '../types.js';

interface AgentRowProps {
  agent: TerminalAgent;
  selected: boolean;
  expanded: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}

/**
 * Format time elapsed since last interaction
 */
function formatTime(date: Date): string {
  const now = Date.now();
  const elapsed = now - date.getTime();

  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Pad string to fixed width
 */
function pad(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + ' '.repeat(width - str.length);
}

export function AgentRow({
  agent,
  selected,
  expanded,
  onApprove,
  onReject,
}: AgentRowProps): React.ReactElement {
  const hasApproval = !!agent.pendingApproval;
  const hasTodos = agent.todos.length > 0;
  const todoSummary = hasTodos
    ? `(${agent.todos.filter((t) => t.status === 'completed').length}/${agent.todos.length} todos)`
    : '';

  return (
    <Box flexDirection="column">
      {/* Main agent row */}
      <Box>
        {/* Selection indicator */}
        <Text color={selected ? 'cyan' : undefined}>
          {selected ? '> ' : '  '}
        </Text>

        {/* Agent name */}
        <Text bold={selected} color={selected ? 'cyan' : undefined}>
          {pad(agent.name, 10)}
        </Text>

        {/* Status */}
        <Box width={18}>
          <StatusBadge status={agent.status} />
        </Box>

        {/* Container */}
        <Text dimColor>
          {pad(agent.containerConfigName || 'unisolated', 12)}
        </Text>

        {/* Diff stats */}
        <Text color="green">+{agent.diffStats.insertions}</Text>
        <Text>/</Text>
        <Text color="red">-{agent.diffStats.deletions}</Text>
        <Text> </Text>

        {/* Time */}
        <Text dimColor>{pad(formatTime(agent.lastInteractionTime), 5)}</Text>

        {/* Collapsed summary */}
        {!expanded && todoSummary && (
          <Text dimColor> {todoSummary}</Text>
        )}

        {/* Approval indicator (always visible) */}
        {hasApproval && !expanded && (
          <Text color="yellow"> [!]</Text>
        )}
      </Box>

      {/* Expanded content */}
      {expanded && (
        <Box flexDirection="column" marginLeft={4}>
          {/* Todos */}
          {hasTodos && (
            <TodoList todos={agent.todos} />
          )}

          {/* Approval prompt */}
          {hasApproval && (
            <ApprovalPrompt
              description={agent.pendingApproval!}
              onApprove={onApprove}
              onReject={onReject}
            />
          )}
        </Box>
      )}
    </Box>
  );
}
