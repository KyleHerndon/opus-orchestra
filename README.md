# Opus Orchestra

Run multiple Claude Code agents in parallel, each in isolated git worktrees. Perfect for tackling large tasks by dividing work across agents that won't step on each other's toes.

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard (Ctrl+Shift+D)                                   │
├─────────────────┬─────────────────┬─────────────────────────┤
│  alpha          │  bravo          │  charlie                │
│  🟢 Working     │  🟡 Waiting     │  🟢 Working             │
│  +127 -34       │  +45 -12        │  +89 -23                │
│  [Focus] [Stop] │  [Focus] [Stop] │  [Focus] [Stop]         │
└─────────────────┴─────────────────┴─────────────────────────┘
```

## Prerequisites

| Requirement | Check | Install |
|-------------|-------|---------|
| VS Code 1.85+ | `code --version` | [Download](https://code.visualstudio.com/) |
| Git | `git --version` | `brew install git` / `apt install git` |
| Claude Code CLI | `claude --version` | [Install Guide](https://docs.anthropic.com/en/docs/claude-code) |
| Node.js 18+ | `node --version` | `brew install node` / [Download](https://nodejs.org/) |

## Installation

```bash
git clone https://github.com/anthropics/opus-orchestra.git
cd opus-orchestra
./install.sh
```

## Quick Start (5 minutes)

### 1. Open your project
Open any git repository in VS Code.

### 2. Create agents
- Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
- Type "Claude Agents: Create Agent Worktrees"
- Choose number of agents (start with 2-3)

### 3. Open the dashboard
Press `Ctrl+Shift+D` (or `Cmd+Shift+D` on Mac)

### 4. Start Claude in each agent
Click the **▶ Start** button on each agent card, or click the terminal and type `claude`.

### 5. Give each agent a task
Click an agent to focus its terminal, then give it a task:
```
Implement the user authentication module in src/auth/
```

That's it! Watch your agents work in parallel from the dashboard.

## How It Works

### Git Worktrees

Each agent works in its own isolated copy of your repo:

```
your-repo/
├── .worktrees/
│   ├── claude-alpha/    # Branch: claude-alpha
│   ├── claude-bravo/    # Branch: claude-bravo
│   └── claude-charlie/  # Branch: claude-charlie
└── (main repo)
```

- **Isolated**: Agents can't overwrite each other's changes
- **Shared history**: All branches stem from the same commit
- **Easy merging**: Standard git merge when agents finish

### Agent Status

| Status | Meaning |
|--------|---------|
| 🟢 Working | Agent is actively running commands |
| 🟡 Waiting | Agent needs input or approval |
| 🔴 Stopped | Claude session ended |
| ⚪ Unknown | Status detection unavailable |

### Dashboard Features

- **Live status** for all agents
- **Git diff stats** (+lines/-lines) per agent
- **One-click actions**: Focus, Start Claude, Delete
- **Rename agents** inline

## Keyboard Shortcuts

| Action | Windows/Linux | Mac |
|--------|---------------|-----|
| Open Dashboard | `Ctrl+Shift+D` | `Cmd+Shift+D` |
| Switch Agent | `Ctrl+Shift+A` | `Cmd+Shift+A` |
| Approval Queue | `Ctrl+Shift+Q` | `Cmd+Shift+Q` |

## Configuration

Open VS Code settings and search for "Claude Agents":

| Setting | Default | Description |
|---------|---------|-------------|
| `terminalType` | `bash` | Terminal: `bash`, `wsl`, `powershell`, `gitbash` |
| `defaultAgentCount` | 3 | Agents to create by default |
| `autoStartClaude` | false | Auto-run `claude` in new terminals |
| `claudeCommand` | `claude` | Command to launch Claude Code |

### Platform-Specific Setup

**macOS / Linux**: Use `terminalType: "bash"` (default)

**Windows (WSL)**: Use `terminalType: "wsl"`

**Windows (Git Bash)**: Use `terminalType: "gitbash"`

## Best Practices

### Task Division
Give agents independent work to avoid merge conflicts:

| Agent | Task |
|-------|------|
| alpha | Backend API routes |
| bravo | Frontend components |
| charlie | Database migrations |

### Merging Strategy
1. Wait for agent to finish and commit
2. From main repo: `git merge claude-alpha`
3. Resolve any conflicts
4. Delete the agent or give it a new task

### Workflow Tips
- Start with 2-3 agents until you're comfortable
- Check the dashboard regularly for waiting agents
- Approve permission requests promptly to keep agents working
- Use descriptive tasks so agents stay focused

## Troubleshooting

### "Claude command not found"
Ensure Claude Code CLI is installed and in your PATH:
```bash
claude --version
```
If not found, see [Claude Code installation](https://docs.anthropic.com/en/docs/claude-code).

### Agents not showing status
Status detection requires Claude Code hooks. Reinitialize:
1. Delete the agent worktree
2. Create a new agent
3. Hooks are auto-installed in new worktrees

### Terminal type issues
If paths look wrong (backslashes vs forward slashes), check `terminalType` setting matches your actual terminal.

### Permission denied on scripts
```bash
chmod +x .claude-agents/*.sh
```

## Advanced: Task Coordination

For teams or complex projects, enable task coordination:

1. **Initialize**: Command Palette → "Claude Agents: Initialize Task Coordination"
2. **Add tasks**: Create markdown files in `.claude-agents/backlog/`
3. **Agents claim tasks**: Agents use `/claim`, `/complete` slash commands
4. **Track progress**: Claims logged to `claims.jsonl`

See [coordination/README.md](coordination/) for details.

## Development

### Running in Development Mode

1. Open the `vscode-extension` folder in VS Code:
   ```bash
   code vscode-extension
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Press `F5` to launch the Extension Development Host

This opens a new VS Code window with your development version of the extension loaded. Changes to TypeScript files auto-compile (watch mode runs automatically).

### Debug Configurations

| Configuration | Description |
|--------------|-------------|
| **Run Extension** | Launch with watch mode (auto-recompile) |
| **Run Extension (No Watch)** | Single compile, then launch |
| **Extension Tests** | Run the test suite |

### Packaging for Distribution

```bash
cd vscode-extension
npx vsce package --allow-missing-repository
```

This creates a `.vsix` file you can share or install with:
```bash
code --install-extension claude-agents-*.vsix
```

### Project Structure

```
opus-orchestra/
├── vscode-extension/       # VS Code extension
│   ├── src/                # TypeScript source
│   │   ├── extension.ts    # Entry point
│   │   ├── agentManager.ts # Agent lifecycle
│   │   ├── agentPanel.ts   # Dashboard webview
│   │   └── pathUtils.ts    # Cross-platform paths
│   ├── coordination/       # Bundled hooks/scripts
│   └── .vscode/            # Dev configurations
├── coordination/           # Standalone scripts
├── install.sh              # Cross-platform installer
└── README.md
```

## License

MIT
