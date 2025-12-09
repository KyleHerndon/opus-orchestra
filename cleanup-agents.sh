#!/bin/bash
# Cleanup Agent Workflow
# Removes worktrees and optionally merges branches
#
# Usage: ./cleanup-agents.sh <repo-path> [--merge]

set -e

REPO_PATH="${1:-.}"
MERGE_FLAG="${2:-}"
SESSION_NAME="claude-agents"
WORKTREE_DIR=".worktrees"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

cd "$REPO_PATH"
REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

# Kill TMUX session
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    log_info "Killing TMUX session: $SESSION_NAME"
    tmux kill-session -t "$SESSION_NAME"
fi

# List worktrees
if [ -d "$WORKTREE_DIR" ]; then
    log_info "Current worktrees:"
    git worktree list

    if [ "$MERGE_FLAG" == "--merge" ]; then
        BASE_BRANCH=$(git branch --show-current)
        log_info "Merging agent branches into $BASE_BRANCH..."

        for worktree in "$WORKTREE_DIR"/agent-*; do
            if [ -d "$worktree" ]; then
                BRANCH_NAME=$(basename "$worktree")
                log_info "Merging $BRANCH_NAME..."
                git merge "$BRANCH_NAME" --no-edit || {
                    log_warn "Merge conflict in $BRANCH_NAME - resolve manually"
                }
            fi
        done
    fi

    log_info "Removing worktrees..."
    for worktree in "$WORKTREE_DIR"/agent-*; do
        if [ -d "$worktree" ]; then
            WORKTREE_NAME=$(basename "$worktree")
            git worktree remove "$worktree" --force 2>/dev/null || rm -rf "$worktree"
            git branch -D "$WORKTREE_NAME" 2>/dev/null || true
            log_info "Removed: $WORKTREE_NAME"
        fi
    done

    rmdir "$WORKTREE_DIR" 2>/dev/null || true
fi

log_info "Cleanup complete!"
echo ""
echo "Remaining branches:"
git branch
