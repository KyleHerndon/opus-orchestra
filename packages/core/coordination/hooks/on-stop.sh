#!/bin/bash
# Hook script that runs when Claude stops and is waiting for input
# Writes a status file so the VS Code extension knows this agent is waiting

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

# Write status file indicating this session is waiting
echo "waiting" > "$STATUS_DIR/$SESSION_ID"
