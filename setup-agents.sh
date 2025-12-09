#!/bin/bash
# Agent Workflow Setup Script
# Creates git worktrees and TMUX session for parallel Claude Code agents
#
# Usage: ./setup-agents.sh <repo-path> [num-agents]
# Example: ./setup-agents.sh ~/projects/myrepo 3

set -e

REPO_PATH="${1:-.}"
NUM_AGENTS="${2:-3}"
SESSION_NAME="claude-agents"
WORKTREE_DIR=".worktrees"
COORDINATION_DIR=".claude-coordination"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Validate repo
cd "$REPO_PATH"
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    log_error "Not a git repository: $REPO_PATH"
    exit 1
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"
log_info "Working in repo: $REPO_ROOT"

# Get current branch as base
BASE_BRANCH=$(git branch --show-current)
log_info "Base branch: $BASE_BRANCH"

# Create coordination directory
mkdir -p "$COORDINATION_DIR"

# Create/update coordination CLAUDE.md
cat > "$COORDINATION_DIR/CLAUDE.md" << 'EOF'
# Multi-Agent Coordination

This directory coordinates multiple Claude Code agents working in parallel.

## Current Agents

Check `agents.md` for the list of active agents and their tasks.

## Workflow

1. Before starting work, check `agents.md` to see what others are doing
2. Update your entry in `agents.md` with your current task
3. When done, mark your task complete and update status
4. Avoid working on the same files as other agents

## Communication

- Use `messages.md` to leave notes for other agents or the user
- Check this file periodically for updates

## Merging

Each agent works on a separate branch. The user will handle merging.
EOF

# Create agents tracking file
cat > "$COORDINATION_DIR/agents.md" << EOF
# Active Agents

| Agent | Branch | Status | Current Task |
|-------|--------|--------|--------------|
EOF

for i in $(seq 1 $NUM_AGENTS); do
    echo "| Agent $i | agent-$i | idle | - |" >> "$COORDINATION_DIR/agents.md"
done

cat >> "$COORDINATION_DIR/agents.md" << 'EOF'

## Status Legend
- **idle**: Ready for a new task
- **working**: Currently executing a task
- **blocked**: Waiting for something
- **done**: Task complete, ready for review
EOF

# Create messages file
cat > "$COORDINATION_DIR/messages.md" << 'EOF'
# Agent Messages

Use this file to communicate between agents and with the user.

---

EOF

# Create worktrees directory
mkdir -p "$WORKTREE_DIR"

log_info "Creating $NUM_AGENTS worktrees..."

for i in $(seq 1 $NUM_AGENTS); do
    BRANCH_NAME="agent-$i"
    WORKTREE_PATH="$WORKTREE_DIR/agent-$i"

    # Remove existing worktree if present
    if [ -d "$WORKTREE_PATH" ]; then
        log_warn "Removing existing worktree: $WORKTREE_PATH"
        git worktree remove "$WORKTREE_PATH" --force 2>/dev/null || rm -rf "$WORKTREE_PATH"
    fi

    # Delete branch if it exists (to start fresh)
    git branch -D "$BRANCH_NAME" 2>/dev/null || true

    # Create new branch and worktree
    git worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" "$BASE_BRANCH"

    # Copy coordination directory to worktree
    cp -r "$COORDINATION_DIR" "$WORKTREE_PATH/"

    log_info "Created worktree: $WORKTREE_PATH (branch: $BRANCH_NAME)"
done

# Check if tmux is available
if ! command -v tmux &> /dev/null; then
    log_warn "TMUX not installed. Install with: sudo apt install tmux"
    log_info "Worktrees created. You can manually open terminals in each:"
    for i in $(seq 1 $NUM_AGENTS); do
        echo "  $WORKTREE_DIR/agent-$i"
    done
    exit 0
fi

# Kill existing session if present
tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

# Create TMUX session
log_info "Creating TMUX session: $SESSION_NAME"

# Create session with first agent
FIRST_WORKTREE="$REPO_ROOT/$WORKTREE_DIR/agent-1"
tmux new-session -d -s "$SESSION_NAME" -c "$FIRST_WORKTREE"
tmux rename-window -t "$SESSION_NAME:0" "agent-1"

# Add windows for remaining agents
for i in $(seq 2 $NUM_AGENTS); do
    WORKTREE_PATH="$REPO_ROOT/$WORKTREE_DIR/agent-$i"
    tmux new-window -t "$SESSION_NAME" -n "agent-$i" -c "$WORKTREE_PATH"
done

# Add a control window in the main repo
tmux new-window -t "$SESSION_NAME" -n "main" -c "$REPO_ROOT"

# Set up status keybinding (Ctrl+B, s to check agent status)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmux bind-key s run-shell "$SCRIPT_DIR/agent-status.sh"

# Configure TMUX to show visual activity indicator
# Window name will show * if there's activity, # if monitored and silent
tmux set-option -t "$SESSION_NAME" -g monitor-activity on
tmux set-option -t "$SESSION_NAME" -g visual-activity off  # Don't show message, just highlight

log_info "Setup complete!"
echo ""
echo "To start working:"
echo "  tmux attach -t $SESSION_NAME"
echo ""
echo "TMUX basics:"
echo "  Ctrl+B, n     - Next window"
echo "  Ctrl+B, p     - Previous window"
echo "  Ctrl+B, 0-9   - Go to window by number"
echo "  Ctrl+B, d     - Detach (keeps session running)"
echo "  Ctrl+B, w     - List windows"
echo "  Ctrl+B, s     - Check agent status (which are waiting)"
echo ""
echo "In each agent window, run:"
echo "  claude"
echo ""
echo "Worktrees:"
for i in $(seq 1 $NUM_AGENTS); do
    echo "  Agent $i: $WORKTREE_DIR/agent-$i (branch: agent-$i)"
done
echo ""
echo "Coordination files:"
echo "  $COORDINATION_DIR/agents.md   - Track agent tasks"
echo "  $COORDINATION_DIR/messages.md - Inter-agent messages"
