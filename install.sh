#!/bin/bash
# Opus Orchestra - Cross-platform installer
# Installs the Claude Agents VS Code extension
#
# Usage: ./install.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Header
echo ""
echo -e "${BLUE}╔═══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║      Opus Orchestra Installer         ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════╝${NC}"
echo ""

# Detect platform
detect_platform() {
    case "$OSTYPE" in
        darwin*)
            PLATFORM="macos"
            ;;
        linux*)
            if grep -q Microsoft /proc/version 2>/dev/null; then
                PLATFORM="wsl"
            else
                PLATFORM="linux"
            fi
            ;;
        msys*|cygwin*|mingw*)
            PLATFORM="gitbash"
            ;;
        *)
            PLATFORM="unknown"
            ;;
    esac
    info "Detected platform: $PLATFORM"
}

# Check prerequisites
check_prerequisites() {
    local missing=()

    info "Checking prerequisites..."

    # Git
    if command -v git &>/dev/null; then
        success "Git $(git --version | cut -d' ' -f3)"
    else
        missing+=("git")
        error "Git not found"
    fi

    # Node.js
    if command -v node &>/dev/null; then
        NODE_VERSION=$(node --version | sed 's/v//')
        NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
        if [ "$NODE_MAJOR" -ge 18 ]; then
            success "Node.js v$NODE_VERSION"
        else
            warn "Node.js v$NODE_VERSION (v18+ recommended)"
        fi
    else
        missing+=("node")
        error "Node.js not found"
    fi

    # npm
    if command -v npm &>/dev/null; then
        success "npm $(npm --version)"
    else
        missing+=("npm")
        error "npm not found"
    fi

    # VS Code
    if command -v code &>/dev/null; then
        success "VS Code $(code --version | head -1)"
    else
        warn "VS Code CLI not in PATH (extension install may fail)"
    fi

    # Claude Code (optional but recommended)
    if command -v claude &>/dev/null; then
        success "Claude Code CLI found"
    else
        warn "Claude Code CLI not found - install from https://claude.ai/code"
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        echo ""
        error "Missing required dependencies: ${missing[*]}"
        echo ""
        echo "Install instructions:"
        case "$PLATFORM" in
            macos)
                echo "  brew install ${missing[*]}"
                ;;
            linux|wsl)
                echo "  sudo apt install ${missing[*]}"
                echo "  # or"
                echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
                echo "  sudo apt install nodejs"
                ;;
            *)
                echo "  Please install: ${missing[*]}"
                ;;
        esac
        exit 1
    fi

    echo ""
}

# Build extension
build_extension() {
    info "Building VS Code extension..."

    cd "$(dirname "$0")/vscode-extension"

    # Install dependencies
    info "Installing npm dependencies..."
    npm install --silent

    # Compile TypeScript
    info "Compiling TypeScript..."
    npm run compile --silent

    # Get version
    VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*: "\(.*\)".*/\1/')

    # Package extension
    info "Packaging extension v$VERSION..."
    npx vsce package --allow-missing-repository --out "claude-agents-${VERSION}.vsix" 2>/dev/null

    VSIX_FILE="claude-agents-${VERSION}.vsix"

    if [ ! -f "$VSIX_FILE" ]; then
        error "Failed to create VSIX package"
        exit 1
    fi

    success "Built $VSIX_FILE"
    echo ""
}

# Install extension
install_extension() {
    info "Installing extension to VS Code..."

    case "$PLATFORM" in
        wsl)
            # WSL: Install to Windows VS Code
            if command -v wslpath &>/dev/null; then
                WIN_PATH=$(wslpath -w "$(pwd)/$VSIX_FILE")
                cmd.exe /c "code --install-extension \"$WIN_PATH\" --force" 2>/dev/null
            else
                code --install-extension "$VSIX_FILE" --force
            fi
            ;;
        *)
            # macOS, Linux, Git Bash: Direct install
            code --install-extension "$VSIX_FILE" --force
            ;;
    esac

    if [ $? -eq 0 ]; then
        success "Extension installed successfully!"
    else
        error "Failed to install extension"
        echo "You can install manually:"
        echo "  code --install-extension $(pwd)/$VSIX_FILE"
        exit 1
    fi
}

# Platform-specific advice
show_next_steps() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║         Installation Complete!        ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
    echo ""
    echo "Next steps:"
    echo ""
    echo "  1. Reload VS Code (Cmd+Shift+P → 'Reload Window')"
    echo ""
    echo "  2. Open a git repository"
    echo ""
    echo "  3. Press Ctrl+Shift+P and run 'Claude Agents: Create Agent Worktrees'"
    echo ""
    echo "  4. Press Ctrl+Shift+D to open the dashboard"
    echo ""

    # Platform-specific config advice
    case "$PLATFORM" in
        wsl)
            echo -e "${YELLOW}WSL detected:${NC} Set terminalType to 'wsl' in VS Code settings"
            echo "  Settings → Claude Agents → Terminal Type → wsl"
            ;;
        macos|linux)
            echo -e "${BLUE}Tip:${NC} Default terminal type 'bash' should work out of the box"
            ;;
        gitbash)
            echo -e "${YELLOW}Git Bash detected:${NC} Set terminalType to 'gitbash' in VS Code settings"
            echo "  Settings → Claude Agents → Terminal Type → gitbash"
            ;;
    esac
    echo ""
}

# Main
detect_platform
check_prerequisites
build_extension
install_extension
show_next_steps
