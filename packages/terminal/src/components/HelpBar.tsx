/**
 * HelpBar - Bottom keyboard shortcuts bar
 */

import React from 'react';
import { Box, Text } from 'ink';

interface HelpBarProps {
  /** Current view for context-specific shortcuts */
  view?: 'agents' | 'diff' | 'settings' | 'log' | 'help';
}

export function HelpBar({ view = 'agents' }: HelpBarProps): React.ReactElement {
  if (view === 'help') {
    return (
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>Press </Text>
        <Text color="cyan">?</Text>
        <Text dimColor> or </Text>
        <Text color="cyan">Esc</Text>
        <Text dimColor> to close help</Text>
      </Box>
    );
  }

  if (view === 'diff') {
    return (
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="cyan">[↑↓]</Text>
        <Text dimColor> Scroll </Text>
        <Text color="cyan">[1]</Text>
        <Text dimColor> Back to list </Text>
        <Text color="cyan">[q]</Text>
        <Text dimColor> Quit</Text>
      </Box>
    );
  }

  if (view === 'settings') {
    return (
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="cyan">[↑↓]</Text>
        <Text dimColor> Navigate </Text>
        <Text color="cyan">[Enter]</Text>
        <Text dimColor> Toggle </Text>
        <Text color="cyan">[1]</Text>
        <Text dimColor> Back </Text>
        <Text color="cyan">[q]</Text>
        <Text dimColor> Quit</Text>
      </Box>
    );
  }

  if (view === 'log') {
    return (
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="cyan">[↑↓]</Text>
        <Text dimColor> Scroll </Text>
        <Text color="cyan">[PgUp/PgDn]</Text>
        <Text dimColor> Page </Text>
        <Text color="cyan">[1]</Text>
        <Text dimColor> Back </Text>
        <Text color="cyan">[q]</Text>
        <Text dimColor> Quit</Text>
      </Box>
    );
  }

  // Default: agents view
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} flexWrap="wrap">
      <Text color="cyan">[↑↓]</Text>
      <Text dimColor> Nav </Text>
      <Text color="cyan">[e/E]</Text>
      <Text dimColor> Expand </Text>
      <Text color="cyan">[Enter]</Text>
      <Text dimColor> Focus </Text>
      <Text color="cyan">[a]</Text>
      <Text dimColor> Approve </Text>
      <Text color="cyan">[r]</Text>
      <Text dimColor> Reject </Text>
      <Text color="cyan">[c]</Text>
      <Text dimColor> Create </Text>
      <Text color="cyan">[x]</Text>
      <Text dimColor> Delete </Text>
      <Text color="cyan">[d]</Text>
      <Text dimColor> Diff </Text>
      <Text color="cyan">[s]</Text>
      <Text dimColor> Settings </Text>
      <Text color="cyan">[l]</Text>
      <Text dimColor> Log </Text>
      <Text color="cyan">[?]</Text>
      <Text dimColor> Help </Text>
      <Text color="cyan">[q]</Text>
      <Text dimColor> Quit</Text>
    </Box>
  );
}
