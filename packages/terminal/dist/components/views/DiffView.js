import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * DiffView - Scrollable git diff viewer
 *
 * Shows the git diff for the selected agent with syntax highlighting.
 */
import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
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
export function DiffView({ agent, onBack }) {
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
        }
        else if (key.downArrow) {
            setScrollOffset((o) => Math.min(MOCK_DIFF.length - terminalHeight, o + 1));
        }
        else if (key.pageUp) {
            setScrollOffset((o) => Math.max(0, o - terminalHeight));
        }
        else if (key.pageDown) {
            setScrollOffset((o) => Math.min(MOCK_DIFF.length - terminalHeight, o + terminalHeight));
        }
    });
    if (!agent) {
        return (_jsxs(Box, { flexDirection: "column", padding: 1, children: [_jsx(Text, { color: "yellow", bold: true, children: "Diff View" }), _jsx(Text, { dimColor: true, children: "No agent selected. Press '1' or Esc to go back." })] }));
    }
    const visibleLines = MOCK_DIFF.slice(scrollOffset, scrollOffset + terminalHeight);
    const hasMore = scrollOffset + terminalHeight < MOCK_DIFF.length;
    const hasLess = scrollOffset > 0;
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { borderStyle: "single", borderColor: "blue", paddingX: 1, children: [_jsxs(Text, { bold: true, color: "blue", children: ["Diff: ", agent.name] }), _jsx(Text, { children: " " }), _jsxs(Text, { dimColor: true, children: ["(", agent.branch, ")"] }), _jsx(Text, { children: " " }), _jsx(Text, { dimColor: true, children: "|" }), _jsx(Text, { children: " " }), _jsxs(Text, { color: "green", children: ["+", agent.diffStats.insertions] }), _jsx(Text, { children: "/" }), _jsxs(Text, { color: "red", children: ["-", agent.diffStats.deletions] }), _jsx(Text, { children: " " }), _jsxs(Text, { dimColor: true, children: ["(", agent.diffStats.filesChanged, " files)"] })] }), hasLess && (_jsx(Box, { justifyContent: "center", children: _jsx(Text, { dimColor: true, children: "\u2191 more above \u2191" }) })), _jsx(Box, { flexDirection: "column", paddingX: 1, children: visibleLines.map((line, index) => (_jsx(DiffLine, { line: line }, scrollOffset + index))) }), hasMore && (_jsx(Box, { justifyContent: "center", children: _jsx(Text, { dimColor: true, children: "\u2193 more below \u2193" }) })), _jsxs(Box, { borderStyle: "single", borderColor: "gray", paddingX: 1, children: [_jsx(Text, { color: "cyan", children: "[\u2191\u2193]" }), _jsx(Text, { dimColor: true, children: " Scroll " }), _jsx(Text, { color: "cyan", children: "[PgUp/PgDn]" }), _jsx(Text, { dimColor: true, children: " Page " }), _jsx(Text, { color: "cyan", children: "[1/Esc]" }), _jsx(Text, { dimColor: true, children: " Back" })] })] }));
}
function DiffLine({ line }) {
    // Determine line type and color
    if (line.startsWith('+++') || line.startsWith('---')) {
        return _jsx(Text, { bold: true, children: line });
    }
    if (line.startsWith('@@')) {
        return _jsx(Text, { color: "cyan", children: line });
    }
    if (line.startsWith('+')) {
        return _jsx(Text, { color: "green", children: line });
    }
    if (line.startsWith('-')) {
        return _jsx(Text, { color: "red", children: line });
    }
    if (line.startsWith('diff --git')) {
        return _jsx(Text, { color: "yellow", bold: true, children: line });
    }
    if (line.startsWith('index ')) {
        return _jsx(Text, { dimColor: true, children: line });
    }
    return _jsx(Text, { children: line });
}
//# sourceMappingURL=DiffView.js.map