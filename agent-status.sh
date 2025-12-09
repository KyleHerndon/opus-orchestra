#!/bin/bash
# Check which Claude Code agents are waiting for input
# Shows a quick overview without switching windows
#
# Usage: ./agent-status.sh
# Or in TMUX: Ctrl+B, : then "run-shell /path/to/agent-status.sh"

SESSION_NAME="claude-agents"

if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "No agent session running"
    exit 1
fi

echo "Agent Status:"
echo "============="

# Get list of windows
tmux list-windows -t "$SESSION_NAME" -F "#{window_index}:#{window_name}" | while read window; do
    INDEX=$(echo "$window" | cut -d: -f1)
    NAME=$(echo "$window" | cut -d: -f2)

    # Skip the main window
    if [ "$NAME" == "main" ]; then
        continue
    fi

    # Capture the last few lines of the pane
    LAST_LINES=$(tmux capture-pane -t "$SESSION_NAME:$INDEX" -p | tail -5)

    # Check for common "waiting" indicators
    # Claude Code shows ">" or similar prompt when waiting
    if echo "$LAST_LINES" | grep -qE '^\s*>\s*$|^\s*\$\s*$|^[^│]*claude.*>\s*$|Human:'; then
        STATUS="⏳ WAITING FOR INPUT"
    elif echo "$LAST_LINES" | grep -qE 'Thinking|Working|Reading|Writing|Searching|Running'; then
        STATUS="🔄 WORKING..."
    else
        STATUS="❓ Unknown"
    fi

    printf "%-10s %s\n" "$NAME:" "$STATUS"
done

echo ""
echo "Switch windows: Ctrl+B, <number> or Ctrl+B, n/p"
