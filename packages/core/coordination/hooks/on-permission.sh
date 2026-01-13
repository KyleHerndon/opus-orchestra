#!/bin/bash
# Hook script that runs when Claude requests permission (PermissionRequest)
# Writes raw hook JSON to status file - TypeScript handles parsing

set -euo pipefail

INPUT=$(cat)

# Extract session_id from JSON input using jq for reliable parsing
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

if [[ -z "$SESSION_ID" ]]; then
    exit 0
fi

STATUS_DIR="$CLAUDE_PROJECT_DIR/.opus-orchestra/status"
mkdir -p "$STATUS_DIR"
echo "$INPUT" > "$STATUS_DIR/$SESSION_ID"
