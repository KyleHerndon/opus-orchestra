#!/bin/bash
# Opus Orchestra Setup Script
# Main entry point for setting up isolation features
#
# Usage:
#   ./setup.sh              # Interactive mode - detect and offer to install
#   ./setup.sh check        # Check what's available
#   ./setup.sh docker       # Set up Docker isolation
#   ./setup.sh gvisor       # Set up gVisor (requires Docker)
#   ./setup.sh firecracker  # Set up Firecracker VMs
#   ./setup.sh sandbox      # Set up sandbox-runtime
#   ./setup.sh all          # Set up everything available for this platform

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETUP_DIR="$SCRIPT_DIR/setup"

# Source common utilities
source "$SETUP_DIR/common.sh"

# Check all components
check_all() {
    print_header
    echo -e "${BLUE}Checking installed components...${NC}"
    echo ""

    echo "Platform: $OS ($ARCH)"
    echo ""

    echo "Isolation Tiers:"

    # Docker
    "$SETUP_DIR/docker.sh" check 2>/dev/null || true

    # gVisor
    "$SETUP_DIR/gvisor.sh" check 2>/dev/null || true

    # Sandbox
    "$SETUP_DIR/sandbox.sh" check 2>/dev/null || true

    # Firecracker (Linux only)
    if [[ "$OS" == "linux" ]]; then
        "$SETUP_DIR/firecracker.sh" check 2>/dev/null || true
    elif [[ "$OS" == "wsl" ]]; then
        print_status "info" "Firecracker" "not supported in WSL (no KVM)"
    elif [[ "$OS" == "macos" ]]; then
        print_status "info" "Firecracker" "not supported on macOS"
    fi

    echo ""
}

# Setup all available features
setup_all() {
    print_header
    echo -e "${BLUE}Setting up all available isolation features...${NC}"
    echo ""

    # Sandbox (lightweight, try first)
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    "$SETUP_DIR/sandbox.sh" setup || true
    echo ""

    # Docker
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    "$SETUP_DIR/docker.sh" setup || true
    echo ""

    # gVisor (Linux only, requires Docker)
    if [[ "$OS" == "linux" ]]; then
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        "$SETUP_DIR/gvisor.sh" setup || true
        echo ""

        # Firecracker (Linux with KVM only)
        if [[ -e /dev/kvm ]]; then
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            "$SETUP_DIR/firecracker.sh" setup || true
            echo ""
        fi
    fi

    echo ""
    echo -e "${GREEN}Setup complete!${NC}"
    echo ""

    # Show final status
    check_all
}

# Interactive mode
interactive_mode() {
    print_header
    check_all

    echo ""
    echo "What would you like to set up?"
    echo ""
    echo "  1) Docker isolation (recommended)"
    echo "  2) gVisor (enhanced Docker isolation, Linux only)"
    echo "  3) Firecracker VMs (Linux only)"
    echo "  4) Sandbox runtime (lightweight)"
    echo "  5) All available features"
    echo "  6) Exit"
    echo ""
    read -p "Select option [1-6]: " choice

    echo ""

    case "$choice" in
        1) "$SETUP_DIR/docker.sh" setup ;;
        2) "$SETUP_DIR/gvisor.sh" setup ;;
        3) "$SETUP_DIR/firecracker.sh" setup ;;
        4) "$SETUP_DIR/sandbox.sh" setup ;;
        5) setup_all ;;
        6) echo "Exiting."; exit 0 ;;
        *) echo "Invalid option"; exit 1 ;;
    esac
}

# Show help
show_help() {
    echo "Opus Orchestra Setup Script"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  check       Check what's available"
    echo "  docker      Set up Docker isolation"
    echo "  gvisor      Set up gVisor (requires Docker, Linux only)"
    echo "  firecracker Set up Firecracker VMs (Linux only)"
    echo "  sandbox     Set up sandbox-runtime"
    echo "  all         Set up everything available"
    echo ""
    echo "Run without arguments for interactive mode."
    echo ""
    echo "Individual setup scripts are in scripts/setup/:"
    echo "  ./scripts/setup/docker.sh [check|build|setup]"
    echo "  ./scripts/setup/gvisor.sh [check|setup]"
    echo "  ./scripts/setup/firecracker.sh [check|kernel|kvm|setup]"
    echo "  ./scripts/setup/sandbox.sh [check|test|setup]"
}

# Main
case "${1:-}" in
    check)
        check_all
        ;;
    docker)
        "$SETUP_DIR/docker.sh" setup
        ;;
    gvisor)
        "$SETUP_DIR/gvisor.sh" setup
        ;;
    firecracker)
        "$SETUP_DIR/firecracker.sh" setup
        ;;
    sandbox)
        "$SETUP_DIR/sandbox.sh" setup
        ;;
    all)
        setup_all
        ;;
    -h|--help|help)
        show_help
        ;;
    "")
        interactive_mode
        ;;
    *)
        echo "Unknown command: $1"
        echo "Run '$0 --help' for usage."
        exit 1
        ;;
esac
