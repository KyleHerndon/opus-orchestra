#!/bin/bash
# Common utilities for setup scripts

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if grep -q Microsoft /proc/version 2>/dev/null; then
            echo "wsl"
        else
            echo "linux"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        echo "windows"
    else
        echo "unknown"
    fi
}

# Print status line
print_status() {
    local status=$1
    local name=$2
    local detail=$3

    if [[ "$status" == "ok" ]]; then
        echo -e "  ${GREEN}✓${NC} $name ${detail:+- $detail}"
    elif [[ "$status" == "warn" ]]; then
        echo -e "  ${YELLOW}⚠${NC} $name ${detail:+- $detail}"
    elif [[ "$status" == "error" ]]; then
        echo -e "  ${RED}✗${NC} $name ${detail:+- $detail}"
    elif [[ "$status" == "info" ]]; then
        echo -e "  ${BLUE}ℹ${NC} $name ${detail:+- $detail}"
    fi
}

# Print section header
print_section() {
    echo ""
    echo -e "${BLUE}$1${NC}"
    echo ""
}

# Print header banner
print_header() {
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  Opus Orchestra Setup${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo ""
}

# Check if running as root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        return 0
    else
        return 1
    fi
}

# Require sudo for a command
require_sudo() {
    if check_root; then
        "$@"
    else
        sudo "$@"
    fi
}

# Get architecture
get_arch() {
    local arch=$(uname -m)
    case "$arch" in
        x86_64|amd64)
            echo "x86_64"
            ;;
        aarch64|arm64)
            echo "aarch64"
            ;;
        *)
            echo "$arch"
            ;;
    esac
}

# Check if command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Export variables
OS=$(detect_os)
ARCH=$(get_arch)
