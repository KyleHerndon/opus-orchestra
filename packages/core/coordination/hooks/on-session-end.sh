#!/bin/bash
# Hook script that runs when a Claude session ends (SessionEnd)
# Marks the agent as stopped

set -euo pipefail

# Read the hook input from stdin
INPUT=$(cat)

# Extract session_id from JSON input using jq for reliable parsing
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

if [[ -z "$SESSION_ID" ]]; then
    exit 0
fi

# Use CLAUDE_PROJECT_DIR which is set by Claude Code
STATUS_DIR="$CLAUDE_PROJECT_DIR/.opus-orchestra/status"
mkdir -p "$STATUS_DIR"

# Write status file indicating this session has stopped
echo "stopped" > "$STATUS_DIR/$SESSION_ID"
