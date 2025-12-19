#!/bin/bash
# Hook script that runs when user submits a prompt (UserPromptSubmit)
# Marks the agent as working

set -euo pipefail

# Read the hook input from stdin
INPUT=$(cat)

# Extract session_id from JSON input
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4)

if [[ -z "$SESSION_ID" ]]; then
    exit 0
fi

# Use CLAUDE_PROJECT_DIR which is set by Claude Code
STATUS_DIR="$CLAUDE_PROJECT_DIR/.opus-orchestra/status"
mkdir -p "$STATUS_DIR"

# Write status file indicating this session is working
echo "working" > "$STATUS_DIR/$SESSION_ID"
