# Claude Agents VS Code Extension

A VS Code extension for managing multiple Claude Code agents in parallel.

## Features

### Agent Panel (Sidebar)
- List of all active agents with status indicators
- 🟢 Working - Agent is producing output
- 🟡 Waiting - Agent needs input
- 🔴 Error - Something went wrong
- Click agent to switch to its terminal

### Approval Queue
- Central view of all pending tool approvals across agents
- One-click approve/reject
- Bulk approve for trusted operations

### Agent Terminals
- Each agent gets its own VS Code terminal
- Terminals automatically created in their worktree directories
- Status synced between terminal activity and sidebar

### Quick Actions
- `Ctrl+Shift+A` - Show agent switcher (quick pick)
- `Ctrl+Shift+Q` - Show approval queue
- Status bar shows count of waiting agents

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     VS Code                              │
├──────────────┬─────────────────────┬────────────────────┤
│   Sidebar    │    Editor Area      │    Terminal Area   │
│              │                     │                    │
│ ┌──────────┐ │                     │ ┌────────────────┐ │
│ │ Agent 1  │ │   (your code)       │ │ Agent 1 Term   │ │
│ │ 🟡 wait  │ │                     │ │                │ │
│ ├──────────┤ │                     │ ├────────────────┤ │
│ │ Agent 2  │ │                     │ │ Agent 2 Term   │ │
│ │ 🟢 work  │ │                     │ │ (active)       │ │
│ ├──────────┤ │                     │ ├────────────────┤ │
│ │ Agent 3  │ │                     │ │ Agent 3 Term   │ │
│ │ 🟢 work  │ │                     │ │                │ │
│ └──────────┘ │                     │ └────────────────┘ │
│              │                     │                    │
│ ┌──────────┐ │                     │                    │
│ │ Approvals│ │                     │                    │
│ │ (3)      │ │                     │                    │
│ └──────────┘ │                     │                    │
└──────────────┴─────────────────────┴────────────────────┘
```

## Implementation Plan

### Phase 1: Basic Agent Management
- [ ] Extension scaffold (TypeScript)
- [ ] Tree view provider for agent list
- [ ] Create terminals in worktree directories
- [ ] Agent status detection from terminal output

### Phase 2: Status Detection
- [ ] Monitor terminal output for waiting indicators
- [ ] Update tree view icons based on status
- [ ] Status bar item showing waiting count

### Phase 3: Approval Queue
- [ ] Parse terminal output for approval requests
- [ ] WebView panel showing pending approvals
- [ ] Send approval/rejection to correct terminal

### Phase 4: Quick Actions
- [ ] Command palette commands
- [ ] Keyboard shortcuts
- [ ] Quick pick for agent switching

### Phase 5: Integration with Worktrees
- [ ] Detect/create git worktrees
- [ ] Associate agents with branches
- [ ] Coordination file support

## Technical Details

### Terminal Output Parsing

Claude Code has recognizable patterns when waiting:
- Tool approval prompts
- Question prompts ("Human:")
- Completion prompts

We can use `Terminal.onDidWriteData` (proposed API) or poll the terminal buffer.

### Status Detection Heuristics

```typescript
function detectStatus(recentOutput: string): AgentStatus {
  // Check for approval request patterns
  if (recentOutput.includes('Allow') && recentOutput.includes('?')) {
    return 'waiting-approval';
  }
  // Check for input prompt
  if (recentOutput.match(/>\s*$/) || recentOutput.includes('Human:')) {
    return 'waiting-input';
  }
  // Check for activity indicators
  if (recentOutput.includes('Thinking') ||
      recentOutput.includes('Reading') ||
      recentOutput.includes('Writing')) {
    return 'working';
  }
  return 'idle';
}
```

### Sending Input to Terminal

```typescript
function sendToTerminal(terminal: vscode.Terminal, text: string) {
  terminal.sendText(text);
}

function approveAction(terminal: vscode.Terminal) {
  terminal.sendText('y');  // Or whatever the approval key is
}
```

## Files Structure

```
vscode-extension/
├── package.json          # Extension manifest
├── src/
│   ├── extension.ts      # Main entry point
│   ├── agentManager.ts   # Manages agent terminals
│   ├── agentTreeView.ts  # Sidebar tree provider
│   ├── approvalQueue.ts  # Approval tracking
│   ├── statusBar.ts      # Status bar integration
│   └── worktreeManager.ts # Git worktree integration
├── media/
│   └── icons/            # Status icons
└── README.md
```

## Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Run in VS Code Extension Development Host
F5 in VS Code
```

## Configuration

```json
{
  "claudeAgents.defaultAgentCount": 3,
  "claudeAgents.autoCreateWorktrees": true,
  "claudeAgents.showApprovalNotifications": true
}
```
