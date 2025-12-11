#!/bin/bash
# Firecracker setup for Opus Orchestra
#
# Firecracker provides hardware-level VM isolation using KVM.
# Each agent runs in its own microVM with its own kernel.
#
# Requirements:
#   - Linux with KVM support
#   - /dev/kvm accessible
#
# Usage:
#   ./firecracker.sh         # Install Firecracker
#   ./firecracker.sh check   # Check status
#   ./firecracker.sh kernel  # Download kernel only

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

FC_VERSION="${FC_VERSION:-v1.5.0}"
FC_DATA_DIR="${FC_DATA_DIR:-$HOME/.opus-orchestra/firecracker}"

# Check KVM availability
check_kvm() {
    if [[ -e /dev/kvm ]]; then
        if [[ -r /dev/kvm ]] && [[ -w /dev/kvm ]]; then
            print_status "ok" "KVM" "available and accessible"
            return 0
        else
            print_status "warn" "KVM" "exists but not accessible (check permissions)"
            return 1
        fi
    else
        print_status "error" "KVM" "not available"
        return 1
    fi
}

# Check Firecracker installation
check_firecracker() {
    if command_exists firecracker; then
        local version=$(firecracker --version 2>&1 | head -1)
        print_status "ok" "Firecracker" "$version"
        return 0
    else
        print_status "error" "Firecracker" "not installed"
        return 1
    fi
}

# Check kernel availability
check_kernel() {
    if [[ -f "$FC_DATA_DIR/vmlinux" ]]; then
        local size=$(du -h "$FC_DATA_DIR/vmlinux" | cut -f1)
        print_status "ok" "Kernel" "$FC_DATA_DIR/vmlinux ($size)"
        return 0
    else
        print_status "warn" "Kernel" "not downloaded"
        return 1
    fi
}

# Check rootfs availability
check_rootfs() {
    if [[ -f "$FC_DATA_DIR/rootfs.ext4" ]]; then
        local size=$(du -h "$FC_DATA_DIR/rootfs.ext4" | cut -f1)
        print_status "ok" "Root filesystem" "$FC_DATA_DIR/rootfs.ext4 ($size)"
        return 0
    else
        print_status "warn" "Root filesystem" "not created (see instructions)"
        return 1
    fi
}

# Download Firecracker binary
download_firecracker() {
    print_section "Downloading Firecracker ${FC_VERSION}..."

    local url="https://github.com/firecracker-microvm/firecracker/releases/download/${FC_VERSION}/firecracker-${FC_VERSION}-${ARCH}.tgz"

    echo "Downloading from: $url"
    curl -fsSL -o /tmp/firecracker.tgz "$url"

    echo "Extracting..."
    tar -xzf /tmp/firecracker.tgz -C /tmp

    local release_dir="/tmp/release-${FC_VERSION}-${ARCH}"

    echo "Installing binaries..."
    require_sudo mv "${release_dir}/firecracker-${FC_VERSION}-${ARCH}" /usr/local/bin/firecracker
    require_sudo mv "${release_dir}/jailer-${FC_VERSION}-${ARCH}" /usr/local/bin/jailer
    require_sudo chmod +x /usr/local/bin/firecracker /usr/local/bin/jailer

    # Cleanup
    rm -rf /tmp/firecracker.tgz "$release_dir"

    print_status "ok" "Firecracker installed" "/usr/local/bin/firecracker"
}

# Download kernel
download_kernel() {
    print_section "Downloading kernel..."

    mkdir -p "$FC_DATA_DIR"

    local kernel_url="https://s3.amazonaws.com/spec.ccfc.min/img/quickstart_guide/${ARCH}/kernels/vmlinux.bin"

    echo "Downloading kernel from: $kernel_url"
    curl -fsSL -o "$FC_DATA_DIR/vmlinux" "$kernel_url"

    print_status "ok" "Kernel downloaded" "$FC_DATA_DIR/vmlinux"
}

# Print rootfs instructions
print_rootfs_instructions() {
    print_section "Root Filesystem Setup"

    echo "Firecracker needs a root filesystem image. You have several options:"
    echo ""
    echo -e "${BLUE}Option 1: Use Alpine Linux (smallest, ~50MB)${NC}"
    echo ""
    echo "  # Download Alpine minirootfs"
    echo "  wget https://dl-cdn.alpinelinux.org/alpine/v3.18/releases/${ARCH}/alpine-minirootfs-3.18.4-${ARCH}.tar.gz"
    echo ""
    echo "  # Create ext4 image"
    echo "  dd if=/dev/zero of=$FC_DATA_DIR/rootfs.ext4 bs=1M count=500"
    echo "  mkfs.ext4 $FC_DATA_DIR/rootfs.ext4"
    echo ""
    echo "  # Mount and extract"
    echo "  sudo mkdir -p /tmp/fc-rootfs"
    echo "  sudo mount $FC_DATA_DIR/rootfs.ext4 /tmp/fc-rootfs"
    echo "  sudo tar -xzf alpine-minirootfs-*.tar.gz -C /tmp/fc-rootfs"
    echo ""
    echo "  # Install Node.js and Claude Code"
    echo "  sudo chroot /tmp/fc-rootfs /bin/sh -c 'apk add nodejs npm && npm i -g @anthropic-ai/claude-code'"
    echo ""
    echo "  # Unmount"
    echo "  sudo umount /tmp/fc-rootfs"
    echo ""
    echo -e "${BLUE}Option 2: Use Docker to build rootfs${NC}"
    echo ""
    echo "  # Export from container"
    echo "  docker run --name fc-rootfs opus-orchestra-sandbox:latest sleep 1"
    echo "  docker export fc-rootfs | dd of=$FC_DATA_DIR/rootfs.ext4 bs=1M"
    echo "  docker rm fc-rootfs"
    echo ""
    echo -e "${BLUE}Option 3: Use firecracker-containerd${NC}"
    echo ""
    echo "  See: https://github.com/firecracker-microvm/firecracker-containerd"
    echo ""
}

# Fix KVM permissions
fix_kvm_permissions() {
    print_section "Fixing KVM permissions..."

    if [[ ! -e /dev/kvm ]]; then
        echo "KVM device not found. You may need to:"
        echo "  1. Enable virtualization in BIOS"
        echo "  2. Load KVM module: sudo modprobe kvm kvm_intel (or kvm_amd)"
        return 1
    fi

    # Add user to kvm group
    local kvm_group=$(stat -c '%G' /dev/kvm)
    if ! groups | grep -q "$kvm_group"; then
        echo "Adding $USER to $kvm_group group..."
        require_sudo usermod -aG "$kvm_group" "$USER"
        echo ""
        echo -e "${YELLOW}You need to log out and back in for group changes to take effect.${NC}"
    else
        print_status "ok" "User $USER" "already in $kvm_group group"
    fi
}

# Full setup
setup_firecracker() {
    print_section "Setting up Firecracker..."

    # Platform check
    if [[ "$OS" != "linux" ]]; then
        echo "Firecracker only runs on Linux with KVM support."
        echo ""
        case "$OS" in
            wsl)
                echo "WSL does not support KVM virtualization."
                echo "For Firecracker, you need native Linux."
                ;;
            macos)
                echo "macOS does not support KVM."
                echo "Consider using Docker isolation instead."
                ;;
        esac
        return 1
    fi

    # Check/fix KVM
    if ! check_kvm; then
        echo ""
        fix_kvm_permissions
        echo ""
        echo "After logging out and back in, run this script again."
        return 1
    fi

    # Download Firecracker
    if ! check_firecracker; then
        download_firecracker
    fi

    # Download kernel
    if ! check_kernel; then
        download_kernel
    fi

    # Rootfs instructions
    if ! check_rootfs; then
        print_rootfs_instructions
    fi

    echo ""
    echo -e "${GREEN}Firecracker setup complete!${NC}"
    echo ""
    echo "Configure VS Code settings:"
    echo "  claudeAgents.firecrackerPath: /usr/local/bin/firecracker"
    echo "  claudeAgents.isolationTier: firecracker"
}

# Main
case "${1:-setup}" in
    check)
        check_kvm || true
        check_firecracker || true
        check_kernel || true
        check_rootfs || true
        ;;
    kernel)
        download_kernel
        ;;
    kvm)
        fix_kvm_permissions
        ;;
    setup|"")
        setup_firecracker
        ;;
    *)
        echo "Usage: $0 [check|kernel|kvm|setup]"
        exit 1
        ;;
esac
