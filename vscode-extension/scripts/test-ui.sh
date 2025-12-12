#!/bin/bash
# UI Test Runner - Handles WSL/Windows configuration
#
# vscode-extension-tester needs the VS Code GUI, which runs on Windows.
# This script detects WSL and runs tests via PowerShell when needed.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Convert WSL path to Windows path (use forward slashes for cmd.exe compatibility)
wsl_to_windows() {
    echo "$1" | sed 's|^/mnt/\([a-z]\)/|\U\1:/|'
}

# Check if running in WSL
is_wsl() {
    [[ -f /proc/version ]] && grep -qi microsoft /proc/version
}

# Check if PowerShell is available
has_powershell() {
    command -v powershell.exe &> /dev/null || command -v pwsh.exe &> /dev/null
}

# Get PowerShell executable
get_powershell() {
    if command -v pwsh.exe &> /dev/null; then
        echo "pwsh.exe"
    else
        echo "powershell.exe"
    fi
}

# Check if Node.js is available on Windows
check_windows_node() {
    "/mnt/c/Program Files/nodejs/node.exe" --version &> /dev/null
}

# Run npx command on Windows via cmd.exe
# Uses /v for delayed expansion to set PATH before running npx
win_npx() {
    local win_path=$(wsl_to_windows "$PROJECT_DIR")
    cmd.exe /v /c "set PATH=C:/Program Files/nodejs;!PATH! && cd /d $win_path && npx $*"
}

# Run setup (download VS Code + ChromeDriver)
run_setup() {
    if is_wsl; then
        if ! check_windows_node; then
            echo "ERROR: Node.js not found on Windows"
            echo "  Install Node.js on Windows to run UI tests"
            exit 1
        fi

        echo "WSL detected - running setup via Windows cmd.exe..."
        win_npx extest get-vscode --storage .vscode-test
        win_npx extest get-chromedriver --storage .vscode-test
    else
        npm run test:ui:windows:setup
    fi
}

# Create test repo using WSL git
create_test_repo() {
    local repo_path="$1"
    echo "Creating test repository at: $repo_path"

    # Clean up if exists
    rm -rf "$repo_path"
    mkdir -p "$repo_path"

    # Initialize git repo
    cd "$repo_path"
    git init
    git config user.email "test@test.com"
    git config user.name "Test User"

    # Create initial commit
    echo "# Test Repository" > README.md
    echo "" >> README.md
    echo "This is a test repository for Claude Agents UI tests." >> README.md
    git add .
    git commit -m "Initial commit"

    cd - > /dev/null
    echo "Test repository created successfully"
}

# Clean up test repo
cleanup_test_repo() {
    local repo_path="$1"
    if [[ -d "$repo_path" ]]; then
        echo "Cleaning up test repository at: $repo_path"
        rm -rf "$repo_path"
    fi
}

# Run tests
run_tests() {
    # Create test repo in WSL filesystem (native WSL path)
    local test_repo="/tmp/claude-agents-ui-test-repo-$$"
    local test_exit_code=0

    if is_wsl; then
        if ! check_windows_node; then
            echo "ERROR: Node.js not found on Windows"
            exit 1
        fi

        # Create test repo in WSL native location
        create_test_repo "$test_repo"

        # Get WSL distro name for the path
        local wsl_distro=$(wsl.exe -l -q 2>/dev/null | head -1 | tr -d '\0\r' || echo "Ubuntu")

        # Create a clean extensions directory for isolated testing
        local ext_dir="$PROJECT_DIR/.vscode-test/test-extensions"
        rm -rf "$ext_dir"
        mkdir -p "$ext_dir"

        # Create a workspace file that points to the WSL folder with proper settings
        local workspace_file="$PROJECT_DIR/.vscode-test/test-workspace.code-workspace"
        cat > "$workspace_file" << EOF
{
    "folders": [
        {
            "uri": "vscode-remote://wsl+${wsl_distro}${test_repo}",
            "name": "Test Repository"
        }
    ],
    "settings": {
        "workbench.startupEditor": "none",
        "claudeAgents.terminalType": "wsl",
        "claudeAgents.repositoryPaths": ["${test_repo}"]
    }
}
EOF

        local win_workspace=$(wsl_to_windows "$workspace_file")
        local win_ext_dir=$(wsl_to_windows "$ext_dir")

        echo "WSL detected - running tests via Windows cmd.exe..."
        echo "Test repo (WSL): $test_repo"
        echo "Extensions dir: $win_ext_dir"
        echo "Workspace file: $win_workspace"

        # Package our extension first
        echo "Packaging extension..."
        win_npx vsce package --out .vscode-test/claude-agents.vsix

        # Install Remote-WSL extension to the clean directory
        echo "Installing Remote-WSL extension to isolated directory..."
        win_npx extest install-from-marketplace ms-vscode-remote.remote-wsl --storage .vscode-test --extensions_dir "$win_ext_dir" 2>/dev/null || true

        # Install our extension to the isolated directory
        echo "Installing claude-agents extension to isolated directory..."
        win_npx extest install-vsix --vsix_file .vscode-test/claude-agents.vsix --storage .vscode-test --extensions_dir "$win_ext_dir"

        # Run tests with isolated extensions directory
        win_npx extest run-tests ./out/test/ui/*.test.js --mocha_config .mocharc.json --storage .vscode-test --extensions_dir "$win_ext_dir" -r "$win_workspace" || test_exit_code=$?

        # Clean up
        cleanup_test_repo "$test_repo"
        rm -f "$workspace_file"

        exit $test_exit_code
    else
        npm run test:ui:windows:run
    fi
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
        echo "Checking UI test environment..."
        if is_wsl; then
            echo "  Platform: WSL"
            if has_powershell; then
                echo "  PowerShell: $(get_powershell) ✓"
            else
                echo "  PowerShell: not found ✗"
                exit 1
            fi
            if check_windows_node; then
                echo "  Windows Node.js: ✓"
            else
                echo "  Windows Node.js: not found ✗"
                exit 1
            fi
        else
            echo "  Platform: Native (Linux/macOS/Windows)"
            echo "  Node.js: $(node --version) ✓"
        fi
        echo "Environment OK - ready to run UI tests"
        ;;
    *)
        echo "Usage: $0 [setup|run|check]"
        echo "  setup  - Download VS Code and ChromeDriver (first time)"
        echo "  run    - Run UI tests (default)"
        echo "  check  - Verify environment is configured correctly"
        exit 1
        ;;
esac
