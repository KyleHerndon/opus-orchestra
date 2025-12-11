#!/bin/bash
# gVisor setup for Opus Orchestra
#
# gVisor provides kernel-level isolation by intercepting syscalls in userspace.
# It runs as a Docker runtime called 'runsc'.
#
# Usage:
#   ./gvisor.sh         # Install and configure gVisor
#   ./gvisor.sh check   # Check gVisor status

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Check if gVisor is configured as Docker runtime
check_gvisor() {
    if ! command_exists docker; then
        print_status "error" "gVisor" "requires Docker"
        return 1
    fi

    if ! docker info &> /dev/null; then
        print_status "error" "gVisor" "Docker daemon not running"
        return 1
    fi

    if docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q "runsc"; then
        local version=""
        if command_exists runsc; then
            version=$(runsc --version 2>&1 | head -1 | cut -d' ' -f3)
        fi
        print_status "ok" "gVisor (runsc)" "${version:-available as Docker runtime}"
        return 0
    else
        print_status "error" "gVisor" "not configured as Docker runtime"
        return 1
    fi
}

# Install gVisor on Linux
install_gvisor_linux() {
    print_section "Installing gVisor..."

    local url_base="https://storage.googleapis.com/gvisor/releases/release/latest"

    case "$ARCH" in
        x86_64)
            local url="${url_base}/x86_64"
            ;;
        aarch64)
            local url="${url_base}/aarch64"
            ;;
        *)
            print_status "error" "Unsupported architecture" "$ARCH"
            return 1
            ;;
    esac

    echo "Downloading runsc..."
    require_sudo curl -fsSL -o /usr/local/bin/runsc "${url}/runsc"
    require_sudo chmod +x /usr/local/bin/runsc

    echo "Downloading containerd-shim-runsc-v1..."
    require_sudo curl -fsSL -o /usr/local/bin/containerd-shim-runsc-v1 "${url}/containerd-shim-runsc-v1"
    require_sudo chmod +x /usr/local/bin/containerd-shim-runsc-v1

    print_status "ok" "gVisor binaries installed"
}

# Configure Docker to use gVisor runtime
configure_docker_runtime() {
    print_section "Configuring Docker daemon..."

    local daemon_json="/etc/docker/daemon.json"

    if [[ -f "$daemon_json" ]]; then
        # Backup existing config
        require_sudo cp "$daemon_json" "${daemon_json}.bak"
        echo "Backed up existing config to ${daemon_json}.bak"

        # Check if runsc already configured
        if grep -q '"runsc"' "$daemon_json"; then
            print_status "ok" "runsc runtime" "already configured"
            return 0
        fi

        # Merge runtime config using Python (more reliable than jq for complex merges)
        require_sudo python3 -c "
import json
with open('$daemon_json') as f:
    config = json.load(f)
config.setdefault('runtimes', {})
config['runtimes']['runsc'] = {'path': '/usr/local/bin/runsc'}
with open('$daemon_json', 'w') as f:
    json.dump(config, f, indent=2)
print('Updated $daemon_json')
"
    else
        # Create new config
        echo '{"runtimes": {"runsc": {"path": "/usr/local/bin/runsc"}}}' | require_sudo tee "$daemon_json" > /dev/null
        echo "Created $daemon_json"
    fi

    print_status "ok" "Docker daemon config" "runsc runtime added"
}

# Restart Docker daemon
restart_docker() {
    echo "Restarting Docker daemon..."

    if command_exists systemctl; then
        require_sudo systemctl restart docker
    elif command_exists service; then
        require_sudo service docker restart
    else
        print_status "warn" "Could not restart Docker" "please restart manually"
        return 1
    fi

    # Wait for Docker to be ready
    local max_wait=30
    local waited=0
    while ! docker info &> /dev/null && [[ $waited -lt $max_wait ]]; do
        sleep 1
        ((waited++))
    done

    if docker info &> /dev/null; then
        print_status "ok" "Docker daemon" "restarted"
        return 0
    else
        print_status "error" "Docker daemon" "failed to restart"
        return 1
    fi
}

# Test gVisor
test_gvisor() {
    print_section "Testing gVisor..."

    echo "Running test container with runsc runtime..."
    if docker run --rm --runtime=runsc hello-world &> /dev/null; then
        print_status "ok" "gVisor test" "container ran successfully"
        return 0
    else
        print_status "error" "gVisor test" "failed to run container"
        return 1
    fi
}

# Full setup
setup_gvisor() {
    print_section "Setting up gVisor..."

    # Platform check
    case "$OS" in
        linux)
            # Continue with setup
            ;;
        wsl)
            echo "gVisor in WSL requires additional configuration."
            echo ""
            echo "Options:"
            echo "  1. Use Docker Desktop with WSL 2 backend (may work, not officially supported)"
            echo "  2. Run on native Linux for full gVisor support"
            echo ""
            print_status "warn" "WSL" "gVisor support is limited"
            return 1
            ;;
        macos)
            echo "gVisor is not supported on macOS."
            echo "Docker on macOS already runs in a Linux VM."
            print_status "error" "macOS" "gVisor not available"
            return 1
            ;;
        *)
            print_status "error" "Platform" "gVisor only runs on Linux"
            return 1
            ;;
    esac

    # Check Docker first
    if ! command_exists docker || ! docker info &> /dev/null; then
        print_status "error" "Docker required" "run ./docker.sh first"
        return 1
    fi

    # Check if already installed
    if check_gvisor; then
        echo ""
        echo "gVisor is already configured."
        return 0
    fi

    # Install gVisor
    install_gvisor_linux

    # Configure Docker
    configure_docker_runtime

    # Restart Docker
    restart_docker

    # Test
    test_gvisor

    echo ""
    echo -e "${GREEN}gVisor setup complete!${NC}"
    echo ""
    echo "You can now use 'gvisor' isolation tier in Opus Orchestra."
    echo "Set claudeAgents.isolationTier to 'gvisor' in VS Code settings."
}

# Main
case "${1:-setup}" in
    check)
        check_gvisor
        ;;
    setup|"")
        setup_gvisor
        ;;
    *)
        echo "Usage: $0 [check|setup]"
        exit 1
        ;;
esac
