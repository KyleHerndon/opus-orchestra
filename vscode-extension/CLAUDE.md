# Claude Code Notes - Agent Workflow VS Code Extension

## Project Overview

A VS Code extension for managing multiple Claude Code agents working in parallel on git worktrees. Each agent gets its own worktree, terminal, and Claude session.

## Critical Path Handling - MUST READ

### The Problem

This extension runs in **VS Code on Windows** (Windows Node.js) but executes commands in **WSL terminals**. This creates a fundamental path conversion problem:

1. Windows Node.js `path.join()` uses backslashes
2. Windows Node.js `fs` module needs Windows-style paths (`C:/...`)
3. Terminal commands need WSL-style paths (`/mnt/c/...`)

### The Solution: AgentPath Class

**ALWAYS use the `AgentPath` class for path operations.** Never use raw `path.join()` for cross-platform paths.

```typescript
import { agentPath } from './pathUtils';

// Create an AgentPath from any format (WSL, Windows, Git Bash)
const p = agentPath(agent.worktreePath);

// For Node.js fs operations (existsSync, readFileSync, etc.)
const statusDir = p.join('.opus-orchestra', 'status').forNodeFs();
//   → Returns: C:/Users/Kyle/project/.opus-orchestra/status

// For terminal commands (sent to WSL/Git Bash/PowerShell)
const termPath = p.forTerminal();
//   → Returns: /mnt/c/Users/Kyle/project (for WSL)

// For display to users
const displayPath = p.forDisplay();
//   → Returns: C:\Users\Kyle\project
```

### Path Formats Reference

| Context | Format | Example |
|---------|--------|---------|
| Node.js fs operations | `C:/...` (forward slashes work) | `C:/Users/Kyle/project` |
| WSL terminal commands | `/mnt/c/...` | `/mnt/c/Users/Kyle/project` |
| WSL native paths | `/home/user/...` | `/home/kyle/.claude/todos` |
| Git Bash commands | `/c/...` | `/c/Users/Kyle/project` |
| PowerShell/CMD | `C:\...` | `C:\Users\Kyle\project` |

### WSL Native Paths

Files in the WSL filesystem (not on a Windows drive) need special handling. The `AgentPath` class automatically converts WSL native paths to Windows UNC paths:

```typescript
// WSL native path (not on Windows drive)
const p = agentPath('/home/kyle/.claude/todos');

// For Node.js fs operations - converts to UNC path
p.forNodeFs();
//   → Returns: //wsl.localhost/Ubuntu-24.04/home/kyle/.claude/todos

// For WSL terminal commands - stays as-is
p.forTerminal();
//   → Returns: /home/kyle/.claude/todos
```

### Getting the Home Directory

**ALWAYS use `getHomeDir()` instead of `os.homedir()` when accessing user-specific files.** This ensures the correct home directory is used based on the terminal type:

```typescript
import { getHomeDir } from './pathUtils';

// Gets WSL home for WSL terminals, Windows home otherwise
const homeDir = getHomeDir();

// Access Claude Code's data directory
const claudeDir = homeDir.join('.claude', 'todos').forNodeFs();
//   → For WSL: //wsl.localhost/Ubuntu-24.04/home/kyle/.claude/todos
//   → For Windows: C:/Users/Kyle/.claude/todos
```

**BUG 4: Using os.homedir() for cross-platform files**
```typescript
// WRONG - os.homedir() returns Windows home even when using WSL terminal
import * as os from 'os';
const todosDir = path.join(os.homedir(), '.claude', 'todos');
// Returns: C:\Users\Kyle\.claude\todos (wrong location for WSL!)

// CORRECT - Use getHomeDir() to get the appropriate home
import { getHomeDir } from './pathUtils';
const todosDir = getHomeDir().join('.claude', 'todos').forNodeFs();
// Returns: //wsl.localhost/Ubuntu-24.04/home/kyle/.claude/todos (correct!)
```

### Common Path Bugs - DO NOT MAKE THESE MISTAKES

**BUG 1: Using path.join() for WSL paths**
```typescript
// WRONG - Windows Node.js path.join() uses backslashes!
path.join('/mnt/c/Users/Kyle', 'subdir')
// Returns: \mnt\c\Users\Kyle\subdir (BROKEN!)

// CORRECT - Use template strings or AgentPath
`${worktreePath}/.opus-orchestra/status`
// OR
agentPath(worktreePath).join('.opus-orchestra', 'status').forNodeFs()
```

**BUG 2: Using WSL paths with Windows Node.js fs module**
```typescript
// WRONG - Windows Node.js can't read /mnt/c/... paths!
const exists = fs.existsSync('/mnt/c/Users/Kyle/file');
// Returns: false (even if file exists!)

// CORRECT - Convert to Windows format for fs operations
const exists = fs.existsSync(agentPath('/mnt/c/Users/Kyle/file').forNodeFs());
// Checks: C:/Users/Kyle/file
```

**BUG 3: Mixing path formats**
```typescript
// WRONG - toWindowsPath returns C:\..., then joining creates mixed paths
const windowsPath = this.toWindowsPath(agent.worktreePath);  // C:\Users\Kyle
const statusDir = `${windowsPath}/.opus-orchestra/status`;    // C:\Users\Kyle/.opus-orchestra/status (BROKEN!)

// CORRECT - Use AgentPath consistently
const statusDir = agentPath(agent.worktreePath).join('.opus-orchestra', 'status').forNodeFs();
```

### Helper Methods in AgentManager

The `toTerminalPath()` and `toWindowsPath()` methods are thin wrappers around AgentPath:

```typescript
// These exist for backward compatibility but use AgentPath internally
toTerminalPath(inputPath)  → agentPath(inputPath).forTerminal()
toWindowsPath(inputPath)   → agentPath(inputPath).forNodeFs()
```

## Hook System

### How Status Tracking Works

1. Hooks in `.claude/settings.json` fire on Claude events (Stop, PermissionRequest, etc.)
2. Hook scripts write status to `.opus-orchestra/status/{session_id}`
3. Extension polls status directory, reads most recent file by mtime
4. Dashboard updates to show agent status

### Session ID Mismatch

The extension generates a session ID when creating an agent, but Claude may use a different session ID. Solution: scan ALL files in the status directory and use the most recently modified one.

### Hook Events Used

- `UserPromptSubmit` → writes "working" status
- `Stop` → writes "waiting" status
- `SessionEnd` → writes "stopped" status
- `PermissionRequest` → writes JSON with tool name and context

## Agent Naming

Agents use NATO phonetic alphabet names: alpha, bravo, charlie, etc.
- Branch: `claude-{name}` (e.g., `claude-alpha`)
- Worktree: `.worktrees/claude-{name}/`
- Display name: Just `{name}` (e.g., `alpha`)

## Testing

Run tests: `npm run compile && npx mocha --ui tdd ./out/test/suite/agentPanel.test.js`

Tests verify:
- Button data-action attributes match switch case handlers
- All buttons have corresponding message handlers
- Agent cards have required elements (inline rename input, etc.)

## Build & Install

```bash
./compile_and_install.sh  # Compiles, packages, installs to Windows VS Code
```

## File Structure

- `src/pathUtils.ts` - **AgentPath class, getHomeDir(), getWslDistro()** - USE THIS FOR ALL PATH OPERATIONS
- `src/services/TodoService.ts` - Reads Claude Code TODO lists from `~/.claude/todos`
- `src/agentManager.ts` - Agent lifecycle, terminal management, git operations
- `src/agentPanel.ts` - Dashboard webview with agent cards and TODO display
- `src/extension.ts` - Extension activation, commands, polling intervals
- `coordination/` - Bundled hooks and slash commands copied to worktrees

## Debugging

### Debug Logging - CRITICAL

**NEVER use `console.log()` in VS Code extensions** - the output is not accessible. Always use the Logger service which writes to a file.

```typescript
import { getLogger, isLoggerInitialized } from './services/Logger';

// In a class method or function:
if (isLoggerInitialized()) {
    const logger = getLogger().child('MyComponent');
    logger.debug(`methodName: variable=${value}`);
    logger.info('Something happened');
    logger.warn('Warning message');
    logger.error('Error message', error);
}

// Or using optional chaining:
const logger = isLoggerInitialized() ? getLogger().child('MyComponent') : null;
logger?.debug(`variable=${value}`);
```

The log file is written to `debug.log` in the **installed extension directory**:
```bash
# For WSL VS Code (Remote - WSL):
tail -f ~/.vscode-server/extensions/undefined_publisher.opus-orchestra-*/debug.log

# For Windows VS Code:
# Find the installed extension path first
ls /mnt/c/Users/Kyle/.vscode/extensions/ | grep claude-agents
# Then view the log
tail -f "/mnt/c/Users/Kyle/.vscode/extensions/undefined_publisher.opus-orchestra-X.Y.Z/debug.log"
```

Remember to remove debug logging before committing.

## Common Gotchas

### Webview Limitations
- `confirm()` and `prompt()` don't work in VS Code webviews - use `vscode.window.showWarningMessage()` or inline inputs
- Use event delegation with data attributes instead of inline onclick handlers
- Call `acquireVsCodeApi()` only once (use IIFE guard)

### Permission Prompts Vary
Claude's permission prompts have different options for different tools:
- File edits: 1=Allow, 2=Always, 3=Reject, 4=Never
- Bash: 1=Yes, 2=Yes for this type, 3=Text input

Don't hardcode specific reject buttons - use "Respond..." to focus terminal instead.

### Terminal Names on Reload
VS Code terminals may have empty names (`""`) after reload, making it impossible to reconnect agents to existing terminals. This is a known issue - terminals need to be recreated.
