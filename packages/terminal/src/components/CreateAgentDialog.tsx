/**
 * CreateAgentDialog - Dialog for creating new agents
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface CreateAgentDialogProps {
  onConfirm: (count: number) => void;
  onCancel: () => void;
}

export function CreateAgentDialog({
  onConfirm,
  onCancel,
}: CreateAgentDialogProps): React.ReactElement {
  const [count, setCount] = useState(1);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      onConfirm(count);
      return;
    }

    if (key.upArrow) {
      setCount((c) => Math.min(c + 1, 10));
      return;
    }

    if (key.downArrow) {
      setCount((c) => Math.max(c - 1, 1));
      return;
    }

    // Number input
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1 && num <= 10) {
      setCount(num);
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      <Text color="cyan" bold>Create Agents</Text>
      <Text> </Text>
      <Box>
        <Text>Number of agents: </Text>
        <Text color="cyan" bold>{count}</Text>
      </Box>
      <Text dimColor>(Use ↑/↓ or type 1-10)</Text>
      <Text> </Text>
      <Box>
        <Text color="cyan">[Enter]</Text>
        <Text> Create  </Text>
        <Text color="cyan">[Esc]</Text>
        <Text> Cancel</Text>
      </Box>
    </Box>
  );
}
