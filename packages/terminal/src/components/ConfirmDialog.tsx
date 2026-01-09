/**
 * ConfirmDialog - Confirmation dialog overlay
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';

interface ConfirmDialogProps {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  message,
  confirmLabel = 'Yes',
  cancelLabel = 'No',
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y' || key.return) {
      onConfirm();
    } else if (input === 'n' || input === 'N' || key.escape) {
      onCancel();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
    >
      <Text color="yellow" bold>Confirm</Text>
      <Text> </Text>
      <Text>{message}</Text>
      <Text> </Text>
      <Box>
        <Text color="cyan">[y]</Text>
        <Text> {confirmLabel}  </Text>
        <Text color="cyan">[n]</Text>
        <Text> {cancelLabel}</Text>
      </Box>
    </Box>
  );
}
