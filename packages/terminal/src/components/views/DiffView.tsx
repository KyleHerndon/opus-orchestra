/**
 * DiffView - Scrollable git diff viewer
 *
 * Shows the git diff for the selected agent with syntax highlighting.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { isOk } from '@opus-orchestra/core';
import type { TerminalAgent } from '../../types.js';

interface DiffViewProps {
  agent?: TerminalAgent;
  onBack: () => void;
}

// Mock diff content for development
const MOCK_DIFF = `diff --git a/src/auth.ts b/src/auth.ts
index 1234567..abcdefg 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -12,6 +12,15 @@ import { User } from './types';

 export function authenticate(user: User): boolean {
+  // Validate user token
+  if (!user.token) {
+    throw new AuthError('Missing authentication token');
+  }
+
+  // Check token expiration
+  if (isTokenExpired(user.token)) {
+    throw new AuthError('Token has expired');
+  }
+
   return validateCredentials(user);
 }

diff --git a/src/api.ts b/src/api.ts
index 8901234..5678901 100644
--- a/src/api.ts
+++ b/src/api.ts
@@ -5,7 +5,7 @@ import { authenticate } from './auth';

 export async function handleRequest(req: Request): Promise<Response> {
-  const user = getUser(req);
+  const user = await getUser(req);

   if (!authenticate(user)) {
     return new Response('Unauthorized', { status: 401 });
@@ -20,6 +20,12 @@ export async function handleRequest(req: Request): Promise<Response> {
   return processRequest(req, user);
 }

+export async function getUser(req: Request): Promise<User> {
+  const token = req.headers.get('Authorization');
+  return await userService.findByToken(token);
+}
+
 // Helper functions below...`.split('\n');

export function DiffView({ agent, onBack }: DiffViewProps): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [terminalHeight] = useState(20); // Approximate visible lines

  // Reset scroll when agent changes
  useEffect(() => {
    setScrollOffset(0);
  }, [agent?.id]);

  useInput((input, key) => {
    if (key.escape || input === '1') {
      onBack();
      return;
    }

    if (key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
    } else if (key.downArrow) {
      setScrollOffset((o) => Math.min(MOCK_DIFF.length - terminalHeight, o + 1));
    } else if (key.pageUp) {
      setScrollOffset((o) => Math.max(0, o - terminalHeight));
    } else if (key.pageDown) {
      setScrollOffset((o) => Math.min(MOCK_DIFF.length - terminalHeight, o + terminalHeight));
    }
  });

  if (!agent) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow" bold>Diff View</Text>
        <Text dimColor>No agent selected. Press '1' or Esc to go back.</Text>
      </Box>
    );
  }

  const visibleLines = MOCK_DIFF.slice(scrollOffset, scrollOffset + terminalHeight);
  const hasMore = scrollOffset + terminalHeight < MOCK_DIFF.length;
  const hasLess = scrollOffset > 0;

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="single" borderColor="blue" paddingX={1}>
        <Text bold color="blue">Diff: {agent.name}</Text>
        <Text> </Text>
        <Text dimColor>({agent.branch})</Text>
        <Text> </Text>
        <Text dimColor>|</Text>
        <Text> </Text>
        {isOk(agent.diffStats) ? (
          <>
            <Text color="green">+{agent.diffStats.data.insertions}</Text>
            <Text>/</Text>
            <Text color="red">-{agent.diffStats.data.deletions}</Text>
            <Text> </Text>
            <Text dimColor>({agent.diffStats.data.filesChanged} files)</Text>
          </>
        ) : (
          <Text color="yellow">[error: {agent.diffStats.error}]</Text>
        )}
      </Box>

      {/* Scroll indicator top */}
      {hasLess && (
        <Box justifyContent="center">
          <Text dimColor>↑ more above ↑</Text>
        </Box>
      )}

      {/* Diff content */}
      <Box flexDirection="column" paddingX={1}>
        {visibleLines.map((line, index) => (
          <DiffLine key={scrollOffset + index} line={line} />
        ))}
      </Box>

      {/* Scroll indicator bottom */}
      {hasMore && (
        <Box justifyContent="center">
          <Text dimColor>↓ more below ↓</Text>
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

function DiffLine({ line }: { line: string }): React.ReactElement {
  // Determine line type and color
  if (line.startsWith('+++') || line.startsWith('---')) {
    return <Text bold>{line}</Text>;
  }
  if (line.startsWith('@@')) {
    return <Text color="cyan">{line}</Text>;
  }
  if (line.startsWith('+')) {
    return <Text color="green">{line}</Text>;
  }
  if (line.startsWith('-')) {
    return <Text color="red">{line}</Text>;
  }
  if (line.startsWith('diff --git')) {
    return <Text color="yellow" bold>{line}</Text>;
  }
  if (line.startsWith('index ')) {
    return <Text dimColor>{line}</Text>;
  }

  return <Text>{line}</Text>;
}
