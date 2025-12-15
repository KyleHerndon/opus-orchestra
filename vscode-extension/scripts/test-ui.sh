#!/bin/bash
# UI Test Runner - Handles WSL/Windows configuration
#
# vscode-extension-tester needs the VS Code GUI, which runs on Windows.
# This script detects WSL and runs tests via cmd.exe when needed.
#
# Tests run with:
# - Extension isolation (clean extensions directory with only our extension)
# - WSL terminal type configured via test-settings.json
# - A test git repository opened
#
# Usage:
#   ./scripts/test-ui.sh setup    # Download VS Code + ChromeDriver + create test repo
#   ./scripts/test-ui.sh run      # Run the tests
#   ./scripts/test-ui.sh check    # Check environment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Test configuration - use Windows path for test repo
TEST_REPO_WSL="/mnt/c/Users/Kyle/Documents/claude-agents-test-repo"
TEST_REPO_WIN="C:\\Users\\Kyle\\Documents\\claude-agents-test-repo"
TEST_REPO_CACHE="/mnt/c/Users/Kyle/Documents/.claude-agents-test-repo-cache"
TEST_EXTENSIONS_DIR=".vscode-test/test-extensions"
TEST_SETTINGS_FILE="test-settings.json"

# Convert WSL path to Windows path
wsl_to_windows() {
    echo "$1" | sed 's|^/mnt/\([a-z]\)/|\U\1:/|'
}

# Check if running in WSL
is_wsl() {
    [[ -f /proc/version ]] && grep -qi microsoft /proc/version
}

# Check if Node.js is available on Windows
check_windows_node() {
    "/mnt/c/Program Files/nodejs/node.exe" --version &> /dev/null 2>&1
}

# Create cached test repo template (run once)
create_test_repo_cache() {
    if [[ -d "$TEST_REPO_CACHE/.git" ]]; then
        return 0
    fi
    echo "Creating test repository cache..."
    rm -rf "$TEST_REPO_CACHE"
    mkdir -p "$TEST_REPO_CACHE"
    cd "$TEST_REPO_CACHE"
    git init
    git config user.email "test@test.com"
    git config user.name "Test User"
    echo "# Test Repository for Claude Agents" > README.md
    git add .
    git commit -m "Initial commit"
    cd - > /dev/null
    echo "Cache created at: $TEST_REPO_CACHE"
}

# Reset test repo from cache (fast copy)
reset_test_repo() {
    create_test_repo_cache
    echo "Resetting test repository from cache..."
    rm -rf "$TEST_REPO_WSL"
    cp -r "$TEST_REPO_CACHE" "$TEST_REPO_WSL"
    echo "Test repository ready"
}

# Run setup (download VS Code + ChromeDriver + create test repo)
run_setup() {
    local win_path=$(wsl_to_windows "$PROJECT_DIR")

    if is_wsl; then
        if ! check_windows_node; then
            echo "ERROR: Node.js not found on Windows"
            echo "  Install Node.js on Windows to run UI tests"
            exit 1
        fi

        echo "WSL detected - running setup via Windows cmd.exe..."
        cmd.exe /c "cd /d $win_path && npx extest get-vscode --storage .vscode-test"
        cmd.exe /c "cd /d $win_path && npx extest get-chromedriver --storage .vscode-test"
    else
        npx extest get-vscode --storage .vscode-test
        npx extest get-chromedriver --storage .vscode-test
    fi

    # Create test repo cache
    create_test_repo_cache

    echo ""
    echo "Setup complete! Run './scripts/test-ui.sh run' to execute tests."
}

# Run tests
run_tests() {
    local win_path=$(wsl_to_windows "$PROJECT_DIR")
    local test_exit_code=0

    # Reset test repo from cache for clean state
    reset_test_repo

    if is_wsl; then
        if ! check_windows_node; then
            echo "ERROR: Node.js not found on Windows"
            exit 1
        fi

        echo "Running UI tests with:"
        echo "  - Extension isolation (clean extensions directory)"
        echo "  - Test settings: $TEST_SETTINGS_FILE"
        echo "  - Test repository: $TEST_REPO_WIN"
        echo ""

        # First, install Remote-WSL extension to the isolated directory (needed for WSL terminal support)
        echo "Installing Remote-WSL extension..."
        cmd.exe /c "cd /d $win_path && npx extest install-from-marketplace ms-vscode-remote.remote-wsl --storage .vscode-test --extensions_dir $TEST_EXTENSIONS_DIR" 2>/dev/null || true

        # Run setup-and-run which handles extension packaging and installation
        cmd.exe /c "cd /d $win_path && npx extest setup-and-run ./out/test/ui/*.test.js --mocha_config .mocharc.json --storage .vscode-test --extensions_dir $TEST_EXTENSIONS_DIR --code_settings $TEST_SETTINGS_FILE --open_resource $TEST_REPO_WIN" || test_exit_code=$?

        exit $test_exit_code
    else
        npx extest setup-and-run ./out/test/ui/*.test.js \
            --mocha_config .mocharc.json \
            --storage .vscode-test \
            --extensions_dir "$TEST_EXTENSIONS_DIR" \
            --code_settings "$TEST_SETTINGS_FILE" \
            --open_resource "$TEST_REPO_WIN"
    fi
}

# Check environment
run_check() {
    echo "Checking UI test environment..."
    if is_wsl; then
        echo "  Platform: WSL"
        if check_windows_node; then
            echo "  Windows Node.js: ✓"
        else
            echo "  Windows Node.js: not found ✗"
            echo "    Install Node.js on Windows to run UI tests"
            exit 1
        fi
    else
        echo "  Platform: Native (Linux/macOS/Windows)"
        echo "  Node.js: $(node --version) ✓"
    fi

    if [[ -d "$TEST_REPO_CACHE/.git" ]]; then
        echo "  Test repo cache: $TEST_REPO_CACHE ✓"
    else
        echo "  Test repo cache: not found (will be created on setup/run)"
    fi

    if [[ -f "$PROJECT_DIR/$TEST_SETTINGS_FILE" ]]; then
        echo "  Test settings: $TEST_SETTINGS_FILE ✓"
    else
        echo "  Test settings: $TEST_SETTINGS_FILE not found ✗"
        exit 1
    fi

    echo ""
    echo "Environment OK - ready to run UI tests"
}

# Main
case "${1:-run}" in
    setup)
        run_setup
        ;;
    run)
        run_tests
        ;;
    check)
        run_check
        ;;
    *)
        echo "Usage: $0 [setup|run|check]"
        echo "  setup  - Download VS Code and ChromeDriver, create test repo"
        echo "  run    - Run UI tests (default)"
        echo "  check  - Verify environment is configured correctly"
        exit 1
        ;;
esac
