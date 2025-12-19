#!/bin/bash
# Dump all CI logs for the current branch to /tmp/ci-logs-<branch>/

set -e

BRANCH=$(git rev-parse --abbrev-ref HEAD)
# Use origin remote (your fork), not upstream
REPO=$(git remote get-url origin | sed 's/.*github.com[:/]//' | sed 's/\.git$//')
OUTPUT_DIR="/tmp/ci-logs-${BRANCH}"

echo "Fetching CI runs for branch: $BRANCH"
echo "Repository: $REPO"
echo "Output directory: $OUTPUT_DIR"

# Create output directory
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# Get all run IDs for this branch
RUN_IDS=$(gh run list --repo "$REPO" --branch "$BRANCH" --json databaseId -q '.[].databaseId')

if [ -z "$RUN_IDS" ]; then
    echo "No CI runs found for branch $BRANCH"
    exit 0
fi

echo "Found runs: $RUN_IDS"

for RUN_ID in $RUN_IDS; do
    echo ""
    echo "=== Downloading logs for run $RUN_ID ==="

    RUN_DIR="$OUTPUT_DIR/run-$RUN_ID"
    mkdir -p "$RUN_DIR"

    # Get run info
    gh run view "$RUN_ID" --repo "$REPO" > "$RUN_DIR/summary.txt" 2>&1 || true

    # Download logs
    gh run view "$RUN_ID" --repo "$REPO" --log > "$RUN_DIR/logs.txt" 2>&1 || true

    # Also try to get failed logs specifically
    gh run view "$RUN_ID" --repo "$REPO" --log-failed > "$RUN_DIR/logs-failed.txt" 2>&1 || true

    echo "Saved to $RUN_DIR"
done

echo ""
echo "=== Done ==="
echo "All logs saved to: $OUTPUT_DIR"
ls -la "$OUTPUT_DIR"
