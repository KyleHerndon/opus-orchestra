/**
 * LogView - Display application logs
 *
 * Shows the last N log entries with scrolling support.
 * Error/warn messages are captured from the LogStream.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { isContainerInitialized, getContainer } from '../../services/ServiceContainer.js';
import type { LogEntry } from '@opus-orchestra/core';

interface LogViewProps {
  onBack: () => void;
}

const MAX_VISIBLE_ENTRIES = 15;

export function LogView({ onBack }: LogViewProps): React.ReactElement {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Load entries and subscribe to updates
  useEffect(() => {
    if (!isContainerInitialized()) {
      return;
    }

    const container = getContainer();
    const stream = container.uiLogStream;

    // Load existing entries
    // Note: LogStream doesn't persist to file, so we just show entries since startup
    const lastEntry = stream.getLastEntry();
    if (lastEntry) {
      setEntries([lastEntry]);
    }

    // Subscribe to new entries
    const handleEntry = (entry: LogEntry): void => {
      setEntries((prev) => [...prev, entry]);
      // Auto-scroll to bottom
      setScrollOffset(Math.max(0, entries.length - MAX_VISIBLE_ENTRIES + 1));
    };

    stream.on('entry', handleEntry);

    return () => {
      stream.off('entry', handleEntry);
    };
  }, []);

  useInput((input, key) => {
    if (key.escape || input === '1') {
      onBack();
      return;
    }

    // Scroll
    if (key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
    } else if (key.downArrow) {
      setScrollOffset((o) => Math.min(Math.max(0, entries.length - MAX_VISIBLE_ENTRIES), o + 1));
    } else if (key.pageUp) {
      setScrollOffset((o) => Math.max(0, o - MAX_VISIBLE_ENTRIES));
    } else if (key.pageDown) {
      setScrollOffset((o) => Math.min(Math.max(0, entries.length - MAX_VISIBLE_ENTRIES), o + MAX_VISIBLE_ENTRIES));
    }
  });

  const visibleEntries = entries.slice(scrollOffset, scrollOffset + MAX_VISIBLE_ENTRIES);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="single" borderColor="blue" paddingX={1}>
        <Text bold color="blue">Log</Text>
        <Text> </Text>
        <Text dimColor>| Error/Warning messages ({entries.length} total)</Text>
      </Box>

      {/* Log entries */}
      <Box flexDirection="column" paddingY={1} minHeight={MAX_VISIBLE_ENTRIES + 2}>
        {entries.length === 0 ? (
          <Box paddingX={1}>
            <Text dimColor>No log entries yet.</Text>
          </Box>
        ) : (
          visibleEntries.map((entry, index) => (
            <LogEntryRow key={scrollOffset + index} entry={entry} />
          ))
        )}
      </Box>

      {/* Scroll indicator */}
      {entries.length > MAX_VISIBLE_ENTRIES && (
        <Box paddingX={1}>
          <Text dimColor>
            Showing {scrollOffset + 1}-{Math.min(scrollOffset + MAX_VISIBLE_ENTRIES, entries.length)} of {entries.length}
          </Text>
        </Box>
      )}

      {/* Footer */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="cyan">[↑↓]</Text>
        <Text dimColor> Scroll </Text>
        <Text color="cyan">[PgUp/PgDn]</Text>
        <Text dimColor> Page </Text>
        <Text color="cyan">[1/Esc]</Text>
        <Text dimColor> Back</Text>
      </Box>
    </Box>
  );
}

interface LogEntryRowProps {
  entry: LogEntry;
}

function LogEntryRow({ entry }: LogEntryRowProps): React.ReactElement {
  const levelColor = entry.level === 'error' ? 'red' : 'yellow';
  const levelLabel = entry.level === 'error' ? 'ERR' : 'WRN';
  const time = entry.timestamp.toLocaleTimeString();

  return (
    <Box paddingX={1}>
      <Text dimColor>[{time}]</Text>
      <Text> </Text>
      <Text color={levelColor} bold>[{levelLabel}]</Text>
      <Text> </Text>
      <Text>{entry.message}</Text>
    </Box>
  );
}
