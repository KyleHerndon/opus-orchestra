#!/bin/bash
# UI Test Runner - Handles WSL/Windows configuration
#
# vscode-extension-tester needs the VS Code GUI, which runs on Windows.
# This script detects WSL and runs tests via cmd.exe when needed.
#
# IMPORTANT NOTES FOR FUTURE DEVELOPERS:
# =====================================
# 1. TEST REPO PATH: The test repository path is configured in TWO places:
#    - This script (TEST_REPO_WSL, TEST_REPO_WIN) - used for creating/resetting the repo
#    - test-settings.json (claudeAgents.repositoryPaths) - used by the extension
#    If you change the path, update BOTH locations!
#
# 2. WSL REMOTE NOT SUPPORTED: vscode-extension-tester does NOT support opening
#    folders via WSL remote (vscode-remote://wsl+...). The extension runs in
#    Windows VS Code context, not WSL remote. This means:
#    - Terminals created by the extension are Windows terminals, not WSL
#    - tmux must be DISABLED for tests (it's a Linux command)
#    - Git commands work because CommandService wraps them with `wsl bash -c`
#
# 3. TMUX DISABLED: test-settings.json sets useTmux=false because VS Code
#    terminals in the test environment are Windows terminals, not WSL shells.
#    The extension's tmux mode expects `shellPath: 'tmux'` to work, which
#    only works when VS Code is connected to WSL remote (not supported here).
#
# 4. WHY TESTS MIGHT FAIL:
#    - "No repository configured" -> Check test-settings.json has correct repositoryPaths
#    - Agent creation timeout -> Check the test repo exists and is a git repo
#    - Container configs not found -> Check .opus-orchestra/containers/ exists in test repo
#    - Terminal errors -> Ensure useTmux is false in test-settings.json
#
# Tests run with:
# - Extension isolation (clean extensions directory with only our extension)
# - WSL terminal type configured via test-settings.json
# - A test git repository with container configs
#
# Usage:
#   ./scripts/test-ui.sh setup    # Download VS Code + ChromeDriver + create test repo
#   ./scripts/test-ui.sh run      # Run the tests
#   ./scripts/test-ui.sh check    # Check environment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Test configuration
# IMPORTANT: If you change this path, also update test-settings.json repositoryPaths!
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

# Run a command on Windows via cmd.exe
# Uses .cmd versions of npm/npx to avoid PowerShell issues
run_win_cmd() {
    local win_path=$(wsl_to_windows "$PROJECT_DIR")
    # Replace forward slashes in remaining args for Windows compatibility
    cmd.exe /c "cd /d $win_path && $*"
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

    # Create container configs for testing container discovery
    mkdir -p .opus-orchestra/containers/docker
    mkdir -p .opus-orchestra/containers/cloud-hypervisor

    # Docker dev config
    cat > .opus-orchestra/containers/dev.json << 'DEVEOF'
{
    "type": "docker",
    "file": "docker/dev.json"
}
DEVEOF

    cat > .opus-orchestra/containers/docker/dev.json << 'DOCKERDEVEOF'
{
    "name": "Development",
    "description": "Full internet access for development",
    "image": "ghcr.io/kyleherndon/opus-orchestra-sandbox:latest",
    "memoryLimit": "4g",
    "cpuLimit": "2",
    "network": "bridge"
}
DOCKERDEVEOF

    # Docker ui-tests config
    cat > .opus-orchestra/containers/ui-tests.json << 'UITESTSEOF'
{
    "type": "docker",
    "file": "docker/ui-tests.json"
}
UITESTSEOF

    cat > .opus-orchestra/containers/docker/ui-tests.json << 'DOCKERUITESTSEOF'
{
    "name": "UI Tests",
    "description": "VS Code UI testing with xvfb",
    "image": "ghcr.io/kyleherndon/opus-orchestra-sandbox:ui-tests",
    "memoryLimit": "8g",
    "cpuLimit": "4",
    "network": "bridge"
}
DOCKERUITESTSEOF

    # Cloud Hypervisor dev config
    cat > .opus-orchestra/containers/ch-dev.json << 'CHDEVEOF'
{
    "type": "cloud-hypervisor",
    "file": "cloud-hypervisor/dev.json"
}
CHDEVEOF

    cat > .opus-orchestra/containers/cloud-hypervisor/dev.json << 'CHDEVDEFEOF'
{
    "name": "Development VM",
    "description": "Cloud Hypervisor VM with virtio-fs mounts",
    "memoryMB": 4096,
    "vcpuCount": 2,
    "mounts": []
}
CHDEVDEFEOF

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
    if is_wsl; then
        if ! check_windows_node; then
            echo "ERROR: Node.js not found on Windows"
            echo "  Install Node.js on Windows to run UI tests"
            exit 1
        fi

        echo "WSL detected - running setup via Windows cmd.exe..."

        # Use npm.cmd explicitly to avoid PowerShell issues
        echo "Installing npm dependencies..."
        run_win_cmd "npm.cmd install"

        echo "Downloading VS Code..."
        run_win_cmd "npx.cmd extest get-vscode --storage .vscode-test"

        echo "Downloading ChromeDriver..."
        run_win_cmd "npx.cmd extest get-chromedriver --storage .vscode-test"
    else
        npm install
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

        # Ensure dependencies are installed
        echo "Checking npm dependencies..."
        run_win_cmd "npm.cmd install" || true

        # Build core package first (vscode depends on it for type-checking and bundling)
        echo "Building @opus-orchestra/core..."
        local win_monorepo_root=$(wsl_to_windows "$(dirname "$(dirname "$PROJECT_DIR")")")
        run_win_cmd "cd /d $win_monorepo_root\\packages\\core && npm.cmd run build" || { echo "ERROR: Core build failed"; exit 1; }

        # Compile tests with tsc (outputs individual files for test imports)
        echo "Compiling extension and tests (tsc)..."
        run_win_cmd "npm.cmd run compile" || { echo "ERROR: TypeScript compilation failed"; exit 1; }

        # Package extension (runs esbuild via vscode:prepublish, bundles core)
        echo "Packaging extension (esbuild bundles everything, --no-dependencies for monorepo)..."
        run_win_cmd "npx.cmd vsce package --no-dependencies --allow-missing-repository --skip-license" || { echo "ERROR: Packaging failed"; exit 1; }

        # Download VS Code if needed
        echo "Setting up test environment..."
        run_win_cmd "npx.cmd extest get-vscode --storage .vscode-test" || true
        run_win_cmd "npx.cmd extest get-chromedriver --storage .vscode-test" || true

        # Install our pre-built extension
        echo "Installing extension from vsix..."
        local vsix_file=$(ls -1 *.vsix 2>/dev/null | head -1)
        run_win_cmd "npx.cmd extest install-vsix --vsix_file $vsix_file --storage .vscode-test --extensions_dir $TEST_EXTENSIONS_DIR" || true

        # Install Remote-WSL extension (needed for WSL terminal support)
        echo "Installing Remote-WSL extension..."
        run_win_cmd "npx.cmd extest install-from-marketplace ms-vscode-remote.remote-wsl --storage .vscode-test --extensions_dir $TEST_EXTENSIONS_DIR" 2>/dev/null || true

        # Run tests (not setup-and-run, since we already set up and installed)
        echo "Running tests..."
        run_win_cmd "npx.cmd extest run-tests out/test/ui/dashboard.test.js --mocha_config .mocharc.json --storage .vscode-test --extensions_dir $TEST_EXTENSIONS_DIR --code_settings $TEST_SETTINGS_FILE --open_resource \"$TEST_REPO_WIN\"" || test_exit_code=$?

        exit $test_exit_code
    else
        npm install
        npm run compile
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
            local node_ver=$("/mnt/c/Program Files/nodejs/node.exe" --version 2>/dev/null)
            echo "  Windows Node.js: $node_ver ✓"
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

    # Check if vscode-extension-tester is installed
    if [[ -d "$PROJECT_DIR/node_modules/vscode-extension-tester" ]]; then
        echo "  vscode-extension-tester: installed ✓"
    else
        echo "  vscode-extension-tester: not installed (run 'npm install')"
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
