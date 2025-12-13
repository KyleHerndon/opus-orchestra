#!/bin/bash
# Test script for agent-workflow
# Tests worktree creation/cleanup without TMUX (for CI compatibility)
#
# Usage: ./test.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$SCRIPT_DIR"  # Test on self

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }
info() { echo -e "${YELLOW}[TEST]${NC} $1"; }

cleanup() {
    info "Cleaning up..."
    cd "$REPO_DIR"
    # Kill tmux session if exists
    tmux kill-session -t claude-agents 2>/dev/null || true
    # Remove worktrees
    if [ -d ".worktrees" ]; then
        for wt in .worktrees/agent-*; do
            [ -d "$wt" ] && git worktree remove "$wt" --force 2>/dev/null || rm -rf "$wt"
        done
        rmdir .worktrees 2>/dev/null || true
    fi
    # Remove agent branches
    git branch | grep "agent-" | xargs -r git branch -D 2>/dev/null || true
    # Remove coordination dir
    rm -rf .claude-coordination
}

# Clean up before and after tests
trap cleanup EXIT
cleanup

echo "========================================"
echo "Testing agent-workflow scripts"
echo "========================================"
echo ""

cd "$REPO_DIR"

# Test 1: Check we're in a git repo
info "Test 1: Verify git repo"
if git rev-parse --git-dir > /dev/null 2>&1; then
    pass "In a git repository"
else
    fail "Not in a git repository"
    exit 1
fi

# Test 2: Run setup (will create worktrees, may skip tmux)
info "Test 2: Run setup-agents.sh"

# Temporarily disable tmux check by running the worktree parts only
NUM_AGENTS=2
BASE_BRANCH=$(git branch --show-current)

# Handle detached HEAD state in CI (PR checkouts)
if [ -z "$BASE_BRANCH" ]; then
    BASE_BRANCH="HEAD"
fi

mkdir -p .worktrees
mkdir -p .claude-coordination

for i in 1 2; do
    BRANCH_NAME="agent-$i"
    WORKTREE_PATH=".worktrees/agent-$i"

    git branch -D "$BRANCH_NAME" 2>/dev/null || true
    git worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" "$BASE_BRANCH" 2>/dev/null
done

if [ -d ".worktrees/agent-1" ] && [ -d ".worktrees/agent-2" ]; then
    pass "Worktrees created"
else
    fail "Worktrees not created"
fi

# Test 3: Verify branches exist
info "Test 3: Verify agent branches"
if git branch | grep -q "agent-1" && git branch | grep -q "agent-2"; then
    pass "Agent branches created"
else
    fail "Agent branches not found"
fi

# Test 4: Verify worktrees are on correct branches
info "Test 4: Verify worktree branches"
WT1_BRANCH=$(cd .worktrees/agent-1 && git branch --show-current)
WT2_BRANCH=$(cd .worktrees/agent-2 && git branch --show-current)

if [ "$WT1_BRANCH" == "agent-1" ] && [ "$WT2_BRANCH" == "agent-2" ]; then
    pass "Worktrees on correct branches"
else
    fail "Worktree branches incorrect (got: $WT1_BRANCH, $WT2_BRANCH)"
fi

# Test 5: Verify worktrees have repo content
info "Test 5: Verify worktree content"
if [ -f ".worktrees/agent-1/README.md" ] && [ -f ".worktrees/agent-2/setup-agents.sh" ]; then
    pass "Worktrees have repo content"
else
    fail "Worktrees missing content"
fi

# Test 6: Test making changes in worktree
info "Test 6: Test isolated changes"
echo "test change" > .worktrees/agent-1/test-file.txt
cd .worktrees/agent-1
# Configure git identity for CI environments
git config user.email "test@ci.local" 2>/dev/null || true
git config user.name "CI Test" 2>/dev/null || true
git add test-file.txt && git commit -m "Test commit from agent-1"
cd "$REPO_DIR"

# Verify change is only in agent-1, not agent-2 or main
if [ -f ".worktrees/agent-1/test-file.txt" ] && \
   [ ! -f ".worktrees/agent-2/test-file.txt" ] && \
   [ ! -f "test-file.txt" ]; then
    pass "Changes isolated to correct worktree"
else
    fail "Changes leaked between worktrees"
fi

# Test 7: Test cleanup
info "Test 7: Test cleanup"
for wt in .worktrees/agent-*; do
    [ -d "$wt" ] && git worktree remove "$wt" --force
done
git branch -D agent-1 agent-2 2>/dev/null || true

# Only check that agent-* worktrees and branches are gone (not .worktrees dir, as other worktrees may exist)
if [ ! -d ".worktrees/agent-1" ] && [ ! -d ".worktrees/agent-2" ] && ! git branch | grep -q "^  agent-"; then
    pass "Cleanup successful"
else
    fail "Cleanup incomplete"
fi

# Summary
echo ""
echo "========================================"
echo "Test Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
echo "========================================"

if [ $TESTS_FAILED -gt 0 ]; then
    exit 1
fi
