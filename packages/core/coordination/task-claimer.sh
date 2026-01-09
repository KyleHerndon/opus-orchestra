#!/bin/bash
# Task Claimer - Atomic task coordination for Claude agents
# Usage:
#   task-claimer.sh claim <task-path> <agent-name>
#   task-claimer.sh release <task-path> <agent-name>
#   task-claimer.sh complete <task-path> <agent-name>
#   task-claimer.sh list-available
#   task-claimer.sh list-claimed
#   task-claimer.sh status <task-path>
#   task-claimer.sh my-task <agent-name>

set -euo pipefail

# Find the .opus-orchestra directory (search up from current dir)
find_agents_dir() {
    local dir="$PWD"
    while [[ "$dir" != "/" ]]; do
        if [[ -d "$dir/.opus-orchestra" ]]; then
            echo "$dir/.opus-orchestra"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    echo "Error: .opus-orchestra directory not found" >&2
    return 1
}

AGENTS_DIR=$(find_agents_dir)
CLAIMS_FILE="$AGENTS_DIR/claims.jsonl"
BACKLOG_DIR="$AGENTS_DIR/backlog"
COMPLETED_DIR="$AGENTS_DIR/completed"
LOCK_FILE="$AGENTS_DIR/.claims.lock"

# Ensure directories exist
mkdir -p "$COMPLETED_DIR"
touch "$CLAIMS_FILE"

# Canonicalize task path - extracts just the filename without extension
canonicalize_task() {
    local task_path="$1"
    # Get just the filename
    local filename=$(basename "$task_path")
    # Remove .md extension if present
    echo "${filename%.md}"
}

# Get current ISO timestamp
timestamp() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# Acquire lock (with timeout)
acquire_lock() {
    local timeout=10
    local count=0
    while ! mkdir "$LOCK_FILE" 2>/dev/null; do
        sleep 0.1
        count=$((count + 1))
        if [[ $count -gt $((timeout * 10)) ]]; then
            echo "Error: Could not acquire lock after ${timeout}s" >&2
            return 1
        fi
    done
    trap 'rm -rf "$LOCK_FILE"' EXIT
}

# Release lock
release_lock() {
    rm -rf "$LOCK_FILE"
    trap - EXIT
}

# Check if a task is currently claimed (not completed or released)
is_task_claimed() {
    local task="$1"
    # Get the last action for this task
    local last_action=$(grep "\"task\":\"$task\"" "$CLAIMS_FILE" 2>/dev/null | tail -1 | grep -o '"action":"[^"]*"' | cut -d'"' -f4)
    [[ "$last_action" == "claim" ]]
}

# Get who claimed a task
get_task_claimer() {
    local task="$1"
    grep "\"task\":\"$task\"" "$CLAIMS_FILE" 2>/dev/null | tail -1 | grep -o '"agent":"[^"]*"' | cut -d'"' -f4
}

# Claim a task
cmd_claim() {
    local task_path="$1"
    local agent_name="$2"
    local task=$(canonicalize_task "$task_path")

    # Check if task exists in backlog
    if [[ ! -f "$BACKLOG_DIR/$task.md" ]]; then
        echo "Error: Task '$task' not found in backlog" >&2
        return 1
    fi

    acquire_lock

    # Check if already claimed
    if is_task_claimed "$task"; then
        local claimer=$(get_task_claimer "$task")
        if [[ "$claimer" == "$agent_name" ]]; then
            echo "Task '$task' is already claimed by you"
            release_lock
            return 0
        else
            echo "Error: Task '$task' is already claimed by '$claimer'" >&2
            release_lock
            return 1
        fi
    fi

    # Check if task is completed
    if [[ -f "$COMPLETED_DIR/$task.md" ]]; then
        echo "Error: Task '$task' is already completed" >&2
        release_lock
        return 1
    fi

    # Append claim
    echo "{\"action\":\"claim\",\"task\":\"$task\",\"agent\":\"$agent_name\",\"timestamp\":\"$(timestamp)\"}" >> "$CLAIMS_FILE"

    release_lock
    echo "Successfully claimed task '$task'"
    echo "Task file: $BACKLOG_DIR/$task.md"
}

# Release a claim without completing
cmd_release() {
    local task_path="$1"
    local agent_name="$2"
    local task=$(canonicalize_task "$task_path")

    acquire_lock

    if ! is_task_claimed "$task"; then
        echo "Error: Task '$task' is not currently claimed" >&2
        release_lock
        return 1
    fi

    local claimer=$(get_task_claimer "$task")
    if [[ "$claimer" != "$agent_name" ]]; then
        echo "Error: Task '$task' is claimed by '$claimer', not '$agent_name'" >&2
        release_lock
        return 1
    fi

    # Append release
    echo "{\"action\":\"release\",\"task\":\"$task\",\"agent\":\"$agent_name\",\"timestamp\":\"$(timestamp)\"}" >> "$CLAIMS_FILE"

    release_lock
    echo "Released claim on task '$task'"
}

# Complete a task
cmd_complete() {
    local task_path="$1"
    local agent_name="$2"
    local task=$(canonicalize_task "$task_path")

    acquire_lock

    # Check claim ownership
    if is_task_claimed "$task"; then
        local claimer=$(get_task_claimer "$task")
        if [[ "$claimer" != "$agent_name" ]]; then
            echo "Error: Task '$task' is claimed by '$claimer', not '$agent_name'" >&2
            release_lock
            return 1
        fi
    fi

    # Move task to completed
    if [[ -f "$BACKLOG_DIR/$task.md" ]]; then
        mv "$BACKLOG_DIR/$task.md" "$COMPLETED_DIR/$task.md"
    fi

    # Append completion
    echo "{\"action\":\"complete\",\"task\":\"$task\",\"agent\":\"$agent_name\",\"timestamp\":\"$(timestamp)\"}" >> "$CLAIMS_FILE"

    release_lock
    echo "Completed task '$task'"
}

# List available (unclaimed, not completed) tasks
cmd_list_available() {
    echo "Available tasks:"
    for f in "$BACKLOG_DIR"/*.md 2>/dev/null; do
        [[ -f "$f" ]] || continue
        local task=$(canonicalize_task "$f")
        if ! is_task_claimed "$task" && [[ ! -f "$COMPLETED_DIR/$task.md" ]]; then
            echo "  - $task"
        fi
    done
}

# List currently claimed tasks
cmd_list_claimed() {
    echo "Claimed tasks:"
    for f in "$BACKLOG_DIR"/*.md 2>/dev/null; do
        [[ -f "$f" ]] || continue
        local task=$(canonicalize_task "$f")
        if is_task_claimed "$task"; then
            local claimer=$(get_task_claimer "$task")
            echo "  - $task (by $claimer)"
        fi
    done
}

# Get status of a specific task
cmd_status() {
    local task_path="$1"
    local task=$(canonicalize_task "$task_path")

    if [[ -f "$COMPLETED_DIR/$task.md" ]]; then
        echo "Status: completed"
    elif is_task_claimed "$task"; then
        local claimer=$(get_task_claimer "$task")
        echo "Status: claimed by $claimer"
    elif [[ -f "$BACKLOG_DIR/$task.md" ]]; then
        echo "Status: available"
    else
        echo "Status: not found"
    fi
}

# Get the task currently claimed by an agent
cmd_my_task() {
    local agent_name="$1"

    for f in "$BACKLOG_DIR"/*.md 2>/dev/null; do
        [[ -f "$f" ]] || continue
        local task=$(canonicalize_task "$f")
        if is_task_claimed "$task"; then
            local claimer=$(get_task_claimer "$task")
            if [[ "$claimer" == "$agent_name" ]]; then
                echo "$task"
                echo "Task file: $BACKLOG_DIR/$task.md"
                return 0
            fi
        fi
    done

    echo "No task currently claimed"
    return 1
}

# Main command dispatch
case "${1:-help}" in
    claim)
        [[ $# -ge 3 ]] || { echo "Usage: $0 claim <task-path> <agent-name>"; exit 1; }
        cmd_claim "$2" "$3"
        ;;
    release)
        [[ $# -ge 3 ]] || { echo "Usage: $0 release <task-path> <agent-name>"; exit 1; }
        cmd_release "$2" "$3"
        ;;
    complete)
        [[ $# -ge 3 ]] || { echo "Usage: $0 complete <task-path> <agent-name>"; exit 1; }
        cmd_complete "$2" "$3"
        ;;
    list-available)
        cmd_list_available
        ;;
    list-claimed)
        cmd_list_claimed
        ;;
    status)
        [[ $# -ge 2 ]] || { echo "Usage: $0 status <task-path>"; exit 1; }
        cmd_status "$2"
        ;;
    my-task)
        [[ $# -ge 2 ]] || { echo "Usage: $0 my-task <agent-name>"; exit 1; }
        cmd_my_task "$2"
        ;;
    help|--help|-h)
        echo "Task Claimer - Atomic task coordination for Claude agents"
        echo ""
        echo "Commands:"
        echo "  claim <task> <agent>     Claim a task for an agent"
        echo "  release <task> <agent>   Release a claim without completing"
        echo "  complete <task> <agent>  Mark a task as completed"
        echo "  list-available           List unclaimed tasks"
        echo "  list-claimed             List claimed tasks and their agents"
        echo "  status <task>            Get status of a specific task"
        echo "  my-task <agent>          Get the task claimed by an agent"
        echo ""
        echo "Task paths are canonicalized - you can use:"
        echo "  - Full path: /path/to/BACKLOG/my-task.md"
        echo "  - Relative: my-task.md"
        echo "  - Just name: my-task"
        ;;
    *)
        echo "Unknown command: $1" >&2
        echo "Run '$0 help' for usage" >&2
        exit 1
        ;;
esac
