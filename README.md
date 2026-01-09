# Opus Orchestra

A VS Code extension for running multiple Claude Code agents in parallel, each in their own git worktree and branch.

## Features

- **Parallel Agents**: Run multiple Claude Code instances simultaneously
- **Git Worktree Isolation**: Each agent works in its own worktree with a dedicated branch
- **Dashboard**: Visual dashboard to monitor and manage all agents
- **Session Management**: Agents can resume previous Claude sessions
- **Permission Handling**: Approve or reject agent permission requests from the dashboard

## Installation

### From Source

```bash
git clone https://github.com/KyleHerndon/opus-orchestra
cd opus-orchestra
npm install
npm run build
npx vsce package --allow-missing-repository --no-dependencies
code --install-extension opus-orchestra-*.vsix
```

Or use the install script (WSL):
```bash
cd vscode-extension
./install.sh
```

## Quick Start

1. Open a git repository in VS Code
2. Open the Command Palette (`Ctrl+Shift+P`)
3. Run "Claude Agents: Create Agent Worktrees"
4. Select the number of agents to create
5. Open the dashboard with `Ctrl+Shift+D` or "Claude Agents: Open Dashboard"

## How It Works

### Git Worktrees

Each agent gets its own working directory via git worktrees:
- All share the same git history
- Each has its own branch (`agent-1`, `agent-2`, etc.)
- Changes are isolated until merged
- No file conflicts between agents

```
your-repo/
├── .worktrees/
│   ├── agent-1/     # Full repo copy, branch: agent-1
│   ├── agent-2/     # Full repo copy, branch: agent-2
│   └── agent-3/     # Full repo copy, branch: agent-3
└── (your normal files)
```

### Dashboard

The dashboard (`Ctrl+Shift+D`) shows:
- All active agents with their status
- Git diff stats for each agent's branch
- Terminal output preview
- Buttons to focus, start Claude, or delete agents

### Sidebar

The Claude Agents sidebar (robot icon in activity bar) provides:
- **Agents**: List of all agents with quick actions
- **Backlog**: Task backlog for coordination
- **Pending Approvals**: Permission requests awaiting approval

## Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| Open Dashboard | `Ctrl+Shift+D` | Open the agent dashboard |
| Switch to Agent | `Ctrl+Shift+A` | Quick switch between agents |
| Show Approvals | `Ctrl+Shift+Q` | Show pending approval queue |
| Create Agent Worktrees | - | Create new agent worktrees |
| Cleanup Worktrees | - | Remove agent worktrees and branches |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeAgents.defaultAgentCount` | 3 | Default number of agents to create |
| `claudeAgents.worktreeDirectory` | `.worktrees` | Directory for agent worktrees |
| `claudeAgents.claudeCommand` | `claude` | Command to start Claude Code |
| `claudeAgents.autoStartClaude` | false | Auto-start Claude when creating terminal |
| `claudeAgents.terminalType` | `wsl` | Terminal type (wsl, powershell, cmd, gitbash) |
| `claudeAgents.uiScale` | 1.0 | Dashboard UI scale (0.75 to 1.5) |

## Best Practices

1. **Separate concerns**: Give each agent independent tasks (different files/features)
2. **Avoid conflicts**: Don't have multiple agents edit the same files
3. **Regular merges**: Periodically merge completed work to prevent drift
4. **Use the dashboard**: Monitor agent status and approve permissions promptly

## Requirements

- VS Code 1.85.0 or higher
- Git
- [Claude Code CLI](https://claude.ai/code) installed and authenticated

## License

MIT
