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

# Detect Windows username (may differ from WSL username)
if command -v cmd.exe &> /dev/null; then
    WIN_USER=$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r')
fi
if [ -z "$WIN_USER" ] || [ "$WIN_USER" = "%USERNAME%" ]; then
    # Fallback: find a user directory that has .vscode
    for dir in /mnt/c/Users/*/; do
        if [ -d "${dir}.vscode/extensions" ]; then
            WIN_USER=$(basename "$dir")
            break
        fi
    done
fi

# Test configuration
# IMPORTANT: If you change this path, also update test-settings.json repositoryPaths!
TEST_REPO_WSL="/mnt/c/Users/${WIN_USER}/Documents/claude-agents-test-repo"
TEST_REPO_WIN="C:\\Users\\${WIN_USER}\\Documents\\claude-agents-test-repo"
TEST_REPO_CACHE="/mnt/c/Users/${WIN_USER}/Documents/.claude-agents-test-repo-cache"
WIN_NODE_DIR="/mnt/c/Users/${WIN_USER}/nodejs"
# Store vscode-test files on Windows filesystem to avoid UNC path issues with webview service workers
VSCODE_TEST_DIR="/mnt/c/Users/${WIN_USER}/.vscode-test-opus"
VSCODE_TEST_DIR_WIN="C:\\Users\\${WIN_USER}\\.vscode-test-opus"
TEST_EXTENSIONS_DIR="${VSCODE_TEST_DIR}/test-extensions"
TEST_EXTENSIONS_DIR_WIN="${VSCODE_TEST_DIR_WIN}\\test-extensions"
TEST_SETTINGS_FILE="test-settings.json"

# Convert path to Windows format using wslpath
wsl_to_windows() {
    wslpath -w "$1"
}

# Convert path to Unix format using wslpath
windows_to_wsl() {
    wslpath -u "$1"
}

# Convert path to Windows format with forward slashes
wsl_to_mixed() {
    wslpath -m "$1"
}

# Check if running in WSL
is_wsl() {
    [[ -f /proc/version ]] && grep -qi microsoft /proc/version
}

# Check if Node.js is available on Windows
check_windows_node() {
    "$WIN_NODE_DIR/node.exe" --version &> /dev/null 2>&1 || \
    "/mnt/c/Program Files/nodejs/node.exe" --version &> /dev/null 2>&1
}

# Get Windows Node.js version
get_windows_node_version() {
    "$WIN_NODE_DIR/node.exe" --version 2>/dev/null || \
    "/mnt/c/Program Files/nodejs/node.exe" --version 2>/dev/null
}

# Install Node.js for Windows if not present
install_windows_node() {
    if check_windows_node; then
        return 0
    fi

    echo "Installing Node.js for Windows..."
    local NODE_VERSION="v20.19.0"
    local NODE_ZIP="/tmp/node-win.zip"

    curl -L -o "$NODE_ZIP" "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip" 2>&1 | tail -2
    mkdir -p "$WIN_NODE_DIR"
    unzip -o "$NODE_ZIP" -d /tmp/node-extract > /dev/null
    cp -r /tmp/node-extract/node-${NODE_VERSION}-win-x64/* "$WIN_NODE_DIR/"
    rm -rf /tmp/node-extract "$NODE_ZIP"

    if check_windows_node; then
        echo "Node.js installed successfully: $(get_windows_node_version)"
    else
        echo "ERROR: Failed to install Node.js"
        exit 1
    fi
}

# Run a command on Windows via cmd.exe
# Uses pushd to handle UNC paths (maps temporary drive letter)
run_win_cmd() {
    local win_path=$(wslpath -w "$PROJECT_DIR")
    local win_node_path=$(wslpath -w "$WIN_NODE_DIR")
    cmd.exe /c "set PATH=${win_node_path};%PATH% && pushd ${win_path} && $* && popd"
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
        install_windows_node

        echo "WSL detected - running setup via Windows cmd.exe..."

        # Ensure the test directory exists on Windows
        mkdir -p "$VSCODE_TEST_DIR"

        # Use npm.cmd explicitly to avoid PowerShell issues
        echo "Installing npm dependencies..."
        run_win_cmd "npm.cmd install"

        echo "Downloading VS Code..."
        run_win_cmd "npx.cmd extest get-vscode --storage $VSCODE_TEST_DIR_WIN"

        echo "Downloading ChromeDriver..."
        run_win_cmd "npx.cmd extest get-chromedriver --storage $VSCODE_TEST_DIR_WIN"
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
        install_windows_node

        # Ensure the test directory exists on Windows
        mkdir -p "$VSCODE_TEST_DIR"
        mkdir -p "$TEST_EXTENSIONS_DIR"

        echo "Running UI tests with:"
        echo "  - Extension isolation (clean extensions directory)"
        echo "  - Test settings: $TEST_SETTINGS_FILE"
        echo "  - Test repository: $TEST_REPO_WIN"
        echo "  - VS Code storage: $VSCODE_TEST_DIR_WIN"
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
        run_win_cmd "npx.cmd extest install-from-marketplace ms-vscode-remote.remote-wsl --storage $VSCODE_TEST_DIR_WIN --extensions_dir $TEST_EXTENSIONS_DIR_WIN" 2>/dev/null || true

        # Run tests (not setup-and-run, since we already set up and installed)
        echo "Running tests..."
        run_win_cmd "npx.cmd extest run-tests out/test/ui/dashboard.test.js --mocha_config .mocharc.json --storage $VSCODE_TEST_DIR_WIN --extensions_dir $TEST_EXTENSIONS_DIR_WIN --code_settings $TEST_SETTINGS_FILE --open_resource $TEST_REPO_WIN" || test_exit_code=$?

        exit $test_exit_code
    else
        npm install
        npm run compile
        npx extest setup-and-run ./out/test/ui/*.test.js \
            --mocha_config .mocharc.json \
            --storage .vscode-test \
            --extensions_dir ".vscode-test/test-extensions" \
            --code_settings "$TEST_SETTINGS_FILE" \
            --open_resource "$TEST_REPO_WIN"
    fi
}

# Check environment
run_check() {
    echo "Checking UI test environment..."
    echo "  Windows user: $WIN_USER"
    if is_wsl; then
        echo "  Platform: WSL"
        if check_windows_node; then
            echo "  Windows Node.js: $(get_windows_node_version) ✓"
        else
            echo "  Windows Node.js: not found (will be installed on setup/run)"
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

    if [[ -d "$VSCODE_TEST_DIR" ]]; then
        echo "  VS Code test dir: $VSCODE_TEST_DIR ✓"
    else
        echo "  VS Code test dir: not found (will be created on setup/run)"
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
