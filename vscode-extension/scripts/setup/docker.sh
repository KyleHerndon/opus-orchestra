#!/bin/bash
# Docker setup for Opus Orchestra
#
# Usage:
#   ./docker.sh         # Set up Docker and build sandbox image
#   ./docker.sh check   # Just check Docker status
#   ./docker.sh build   # Just build the sandbox image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

EXTENSION_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Check Docker installation and daemon
check_docker() {
    if command_exists docker; then
        if docker info &> /dev/null; then
            local version=$(docker --version | cut -d' ' -f3 | tr -d ',')
            print_status "ok" "Docker" "v$version"
            return 0
        else
            print_status "warn" "Docker" "installed but daemon not running"
            return 1
        fi
    else
        print_status "error" "Docker" "not installed"
        return 1
    fi
}

# Check if sandbox image exists
check_image() {
    if docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -q "opus-orchestra-sandbox"; then
        local size=$(docker images opus-orchestra-sandbox:latest --format '{{.Size}}')
        print_status "ok" "Sandbox image" "opus-orchestra-sandbox:latest ($size)"
        return 0
    else
        print_status "warn" "Sandbox image" "not built"
        return 1
    fi
}

# Print Docker installation instructions
print_install_instructions() {
    echo ""
    case "$OS" in
        linux)
            echo "To install Docker on Linux:"
            echo ""
            echo "  curl -fsSL https://get.docker.com | sh"
            echo "  sudo usermod -aG docker \$USER"
            echo ""
            echo "Log out and back in for group changes to take effect."
            ;;
        wsl)
            echo "For WSL, you have two options:"
            echo ""
            echo "Option 1: Docker Desktop (recommended)"
            echo "  - Install Docker Desktop on Windows"
            echo "  - Enable WSL 2 integration in Docker Desktop settings"
            echo ""
            echo "Option 2: Docker in WSL"
            echo "  curl -fsSL https://get.docker.com | sh"
            echo "  sudo usermod -aG docker \$USER"
            echo "  sudo service docker start"
            ;;
        macos)
            echo "To install Docker on macOS:"
            echo ""
            echo "  brew install --cask docker"
            echo ""
            echo "Or download Docker Desktop from https://docker.com"
            ;;
        *)
            echo "Please install Docker Desktop from https://docker.com"
            ;;
    esac
    echo ""
}

# Build the sandbox image
build_image() {
    local dockerfile="$EXTENSION_DIR/docker/Dockerfile.sandbox"
    local context="$EXTENSION_DIR/docker"

    if [[ ! -f "$dockerfile" ]]; then
        print_status "error" "Dockerfile not found" "$dockerfile"
        return 1
    fi

    echo "Building sandbox image..."
    echo ""

    docker build \
        -t opus-orchestra-sandbox:latest \
        -f "$dockerfile" \
        "$context"

    if [[ $? -eq 0 ]]; then
        print_status "ok" "Image built" "opus-orchestra-sandbox:latest"
        return 0
    else
        print_status "error" "Build failed" "check output above"
        return 1
    fi
}

# Full setup
setup_docker() {
    print_section "Setting up Docker isolation..."

    # Check if Docker is installed
    if ! command_exists docker; then
        print_status "error" "Docker" "not installed"
        print_install_instructions
        return 1
    fi

    # Check if Docker daemon is running
    if ! docker info &> /dev/null; then
        print_status "warn" "Docker" "daemon not running"
        echo ""

        case "$OS" in
            linux)
                echo "Start Docker with: sudo systemctl start docker"
                ;;
            wsl)
                echo "If using Docker Desktop, make sure it's running on Windows."
                echo "If using Docker in WSL: sudo service docker start"
                ;;
            macos)
                echo "Start Docker Desktop from Applications."
                ;;
        esac
        return 1
    fi

    print_status "ok" "Docker" "is running"

    # Build the image
    echo ""
    build_image

    echo ""
    echo -e "${GREEN}Docker isolation setup complete!${NC}"
    echo ""
    echo "You can now use 'docker' isolation tier in Opus Orchestra."
    echo "Set claudeAgents.isolationTier to 'docker' in VS Code settings."
}

# Main
case "${1:-setup}" in
    check)
        check_docker
        if [[ $? -eq 0 ]]; then
            check_image
        fi
        ;;
    build)
        if check_docker; then
            build_image
        else
            echo "Docker must be running to build the image."
            exit 1
        fi
        ;;
    setup|"")
        setup_docker
        ;;
    *)
        echo "Usage: $0 [check|build|setup]"
        exit 1
        ;;
esac
