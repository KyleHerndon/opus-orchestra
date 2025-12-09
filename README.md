# Multi-Agent Claude Code Workflow

Run multiple Claude Code agents in parallel, each in their own git worktree and branch.

## Prerequisites

```bash
# Install tmux (if not already installed)
sudo apt install tmux
```

## Quick Start

```bash
# Make scripts executable
chmod +x setup-agents.sh cleanup-agents.sh

# Navigate to any git repo and run setup
cd /path/to/your/repo
/path/to/setup-agents.sh . 3   # Creates 3 agent worktrees

# Attach to the TMUX session
tmux attach -t claude-agents

# In each window, start Claude Code
claude
```

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
├── .claude-coordination/
│   ├── CLAUDE.md    # Instructions for agents
│   ├── agents.md    # Task tracking
│   └── messages.md  # Inter-agent communication
└── (your normal files)
```

### TMUX Session

The setup creates a TMUX session with:
- One window per agent (named `agent-1`, `agent-2`, etc.)
- One `main` window in the original repo
- Each agent window starts in its worktree directory

### Coordination Files

`.claude-coordination/agents.md` tracks what each agent is doing:

```markdown
| Agent | Branch | Status | Current Task |
|-------|--------|--------|--------------|
| Agent 1 | agent-1 | working | Implementing feature X |
| Agent 2 | agent-2 | idle | - |
```

Agents can update this file and check what others are working on.

## TMUX Cheatsheet

| Command | Action |
|---------|--------|
| `Ctrl+B, n` | Next window |
| `Ctrl+B, p` | Previous window |
| `Ctrl+B, 0-9` | Go to window by number |
| `Ctrl+B, d` | Detach (session keeps running) |
| `Ctrl+B, w` | List all windows |
| `Ctrl+B, s` | **Check agent status** (which are waiting) |
| `Ctrl+B, &` | Close current window |
| `Ctrl+B, ,` | Rename current window |

## Knowing When Agents Need Input

### Status Bar Indicators
TMUX highlights windows with recent activity:
- **Highlighted name** = Agent is producing output (working)
- **Normal name** = Agent is idle (likely waiting for input)

### Quick Status Check
Press `Ctrl+B, s` to see a summary of which agents are waiting vs working.

### Manual Check
`Ctrl+B, w` shows all windows - quickly scan through them.

Reattach to a detached session:
```bash
tmux attach -t claude-agents
```

## Workflow Tips

### Assigning Tasks

1. Attach to TMUX: `tmux attach -t claude-agents`
2. Switch to an agent window: `Ctrl+B, 1` (for agent-1)
3. Start Claude: `claude`
4. Give the agent a task

### Monitoring Progress

- Switch between agent windows to check progress
- Check `.claude-coordination/agents.md` for status updates
- Use the `main` window to review overall repo state

### Best Practices

1. **Separate concerns**: Give each agent independent tasks (different files/features)
2. **Update status**: Ask agents to update `agents.md` when starting/finishing tasks
3. **Avoid conflicts**: Don't have multiple agents edit the same files
4. **Regular merges**: Periodically merge completed work to prevent drift

### Example Task Assignment

```
You are Agent 1. Before starting:
1. Check .claude-coordination/agents.md to see what other agents are doing
2. Update your row to show your current task

Your task: Implement the LateralIce property from the BACKLOG.

When done:
1. Commit your changes
2. Update agents.md to mark your task complete
```

## Cleanup

```bash
# Remove worktrees and branches (no merge)
./cleanup-agents.sh /path/to/repo

# Remove worktrees and merge all agent branches first
./cleanup-agents.sh /path/to/repo --merge
```

## VS Code Integration

Since you're using VS Code with WSL:

1. Open each worktree as a separate VS Code window:
   ```bash
   code .worktrees/agent-1
   code .worktrees/agent-2
   ```

2. Or use VS Code's integrated terminal with TMUX:
   - Open VS Code terminal
   - Run `tmux attach -t claude-agents`
   - Use TMUX keybindings to switch between agents

## Troubleshooting

### "Not a git repository"
Make sure you run the script from within a git repo or provide the path:
```bash
./setup-agents.sh /path/to/git/repo
```

### TMUX session already exists
The script will kill existing sessions. Or manually:
```bash
tmux kill-session -t claude-agents
```

### Worktree conflicts
If worktrees are in a bad state:
```bash
git worktree prune
./cleanup-agents.sh .
./setup-agents.sh . 3
```

### WSL path issues
Use WSL paths, not Windows paths:
```bash
# Good
./setup-agents.sh /mnt/c/Users/Kyle/projects/myrepo

# Bad
./setup-agents.sh C:\Users\Kyle\projects\myrepo
```
