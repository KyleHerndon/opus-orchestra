#!/bin/bash
# Hook script that runs when Claude requests permission (PermissionRequest)
# Writes raw hook JSON to status file - TypeScript handles parsing

set -euo pipefail

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4)

if [[ -z "$SESSION_ID" ]]; then
    exit 0
fi

STATUS_DIR="$CLAUDE_PROJECT_DIR/.opus-orchestra/status"
mkdir -p "$STATUS_DIR"
echo "$INPUT" > "$STATUS_DIR/$SESSION_ID"
