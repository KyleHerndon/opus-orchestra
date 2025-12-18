#!/bin/bash
# Sandbox runtime setup for Opus Orchestra
#
# Lightweight OS-level isolation using:
#   - bubblewrap (bwrap) on Linux
#   - sandbox-exec on macOS
#
# Usage:
#   ./sandbox.sh         # Install sandbox runtime
#   ./sandbox.sh check   # Check status

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Check bubblewrap (Linux)
check_bwrap() {
    if command_exists bwrap; then
        local version=$(bwrap --version 2>&1 | head -1)
        print_status "ok" "Bubblewrap" "$version"
        return 0
    else
        return 1
    fi
}

# Check sandbox-exec (macOS)
check_sandbox_exec() {
    if command_exists sandbox-exec; then
        print_status "ok" "sandbox-exec" "available (built into macOS)"
        return 0
    else
        return 1
    fi
}

# Check sandbox runtime availability
check_sandbox() {
    case "$OS" in
        linux|wsl)
            if check_bwrap; then
                return 0
            else
                print_status "error" "Bubblewrap" "not installed"
                return 1
            fi
            ;;
        macos)
            if check_sandbox_exec; then
                return 0
            else
                print_status "error" "sandbox-exec" "not found (should be built into macOS)"
                return 1
            fi
            ;;
        *)
            print_status "error" "Sandbox runtime" "not supported on this platform"
            return 1
            ;;
    esac
}

# Install bubblewrap on Linux
install_bwrap() {
    print_section "Installing Bubblewrap..."

    if command_exists apt-get; then
        require_sudo apt-get update
        require_sudo apt-get install -y bubblewrap
    elif command_exists dnf; then
        require_sudo dnf install -y bubblewrap
    elif command_exists yum; then
        require_sudo yum install -y bubblewrap
    elif command_exists pacman; then
        require_sudo pacman -S --noconfirm bubblewrap
    elif command_exists zypper; then
        require_sudo zypper install -y bubblewrap
    elif command_exists apk; then
        require_sudo apk add bubblewrap
    else
        echo "Could not detect package manager."
        echo ""
        echo "Please install bubblewrap manually:"
        echo "  - Debian/Ubuntu: apt install bubblewrap"
        echo "  - Fedora: dnf install bubblewrap"
        echo "  - Arch: pacman -S bubblewrap"
        echo "  - Alpine: apk add bubblewrap"
        return 1
    fi

    print_status "ok" "Bubblewrap installed"
}

# Test bubblewrap
test_bwrap() {
    print_section "Testing Bubblewrap..."

    # Simple test: run a command in a sandbox
    if bwrap --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 2>/dev/null --symlink usr/lib64 /lib64 --proc /proc --dev /dev --unshare-pid /bin/echo "Sandbox works" &> /dev/null; then
        print_status "ok" "Bubblewrap test" "sandbox is functional"
        return 0
    else
        print_status "warn" "Bubblewrap test" "basic sandbox test failed (may still work)"
        return 0  # Don't fail - some systems have different requirements
    fi
}

# Print sandbox profile info for macOS
print_macos_info() {
    print_section "macOS Sandbox Info"

    echo "macOS uses sandbox-exec with profile files (.sb)."
    echo ""
    echo "Opus Orchestra will create sandbox profiles automatically."
    echo "The profiles restrict:"
    echo "  - File system access (only workspace is writable)"
    echo "  - Network access (proxy only)"
    echo "  - Process execution"
    echo ""
    echo "No additional setup is required on macOS."
}

# Full setup
setup_sandbox() {
    print_section "Setting up Sandbox Runtime..."

    case "$OS" in
        linux|wsl)
            if check_bwrap; then
                echo "Bubblewrap is already installed."
            else
                install_bwrap
            fi

            # Verify installation
            if check_bwrap; then
                test_bwrap
            fi
            ;;
        macos)
            if check_sandbox_exec; then
                print_macos_info
            else
                echo "sandbox-exec should be available on macOS."
                echo "If it's missing, your macOS installation may be incomplete."
                return 1
            fi
            ;;
        *)
            echo "Sandbox runtime is not supported on this platform."
            echo "Consider using Docker isolation instead."
            return 1
            ;;
    esac

    echo ""
    echo -e "${GREEN}Sandbox runtime setup complete!${NC}"
    echo ""
    echo "You can now use 'sandbox' isolation tier in Opus Orchestra."
    echo "Set claudeAgents.isolationTier to 'sandbox' in VS Code settings."
}

# Main
case "${1:-setup}" in
    check)
        check_sandbox
        ;;
    test)
        if [[ "$OS" == "linux" ]] || [[ "$OS" == "wsl" ]]; then
            test_bwrap
        else
            echo "Test only available on Linux"
        fi
        ;;
    setup|"")
        setup_sandbox
        ;;
    *)
        echo "Usage: $0 [check|test|setup]"
        exit 1
        ;;
esac
