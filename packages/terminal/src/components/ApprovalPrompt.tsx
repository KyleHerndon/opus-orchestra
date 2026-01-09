/**
 * ApprovalPrompt - Inline approval request display
 *
 * Shows pending approval with action hints.
 */

import React from 'react';
import { Box, Text } from 'ink';

interface ApprovalPromptProps {
  description: string;
  onApprove?: () => void;
  onReject?: () => void;
}

export function ApprovalPrompt({
  description,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onApprove,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onReject,
}: ApprovalPromptProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>└─ </Text>
        <Text color="yellow" bold>⚠ Approval: </Text>
        <Text>{description}</Text>
      </Box>
      <Box marginLeft={3}>
        <Text dimColor>   </Text>
        <Text color="cyan">[a]</Text>
        <Text> Allow  </Text>
        <Text color="cyan">[r]</Text>
        <Text> Reject  </Text>
        <Text color="cyan">[v]</Text>
        <Text> View details</Text>
      </Box>
    </Box>
  );
}
