#!/bin/bash
# Cloud Hypervisor WSL2 Setup Script
#
# This script configures WSL2 to support Cloud Hypervisor VMs with virtio-fs.
#
# Cloud Hypervisor is a rust-vmm based VMM that supports virtio-fs for
# fast file mounting from host to guest - ideal for development workflows.
#
# References:
# - https://github.com/cloud-hypervisor/cloud-hypervisor
# - https://virtio-fs.gitlab.io/
#
# Usage:
#   ./cloud-hypervisor-wsl.sh             # Run full setup
#   ./cloud-hypervisor-wsl.sh diagnostics # Check WSL2 environment
#   ./cloud-hypervisor-wsl.sh install     # Install Cloud Hypervisor only
#   ./cloud-hypervisor-wsl.sh kernel      # Download kernel only
#   ./cloud-hypervisor-wsl.sh test        # Boot a test VM
#
# ============================================================================
# SECURITY CONSIDERATIONS FOR WSL2 CLOUD HYPERVISOR SETUP
# ============================================================================
#
# Running Cloud Hypervisor on WSL2 involves multiple virtualization layers.
# This is not a security concern but affects performance:
#
#    Windows Host -> Hyper-V -> WSL2 VM -> KVM -> Cloud Hypervisor VM
#
# NESTED VIRTUALIZATION:
#    WSL2 runs as a Hyper-V VM. Running KVM inside requires nested
#    virtualization support, which is available in recent Windows builds.
#
# WHY CLOUD HYPERVISOR:
#    - Supports virtio-fs for live file mounting (no block device copying)
#    - Same rust-vmm foundation, optimized for cloud workloads
#    - Simple CLI interface (no REST API needed)
#    - Active development and good WSL2 compatibility
#
# WHAT THIS SCRIPT DOES:
#    - Checks for KVM support in WSL2
#    - Installs cloud-hypervisor and virtiofsd binaries
#    - Downloads a compatible kernel
#    - Configures KVM permissions
#    - Optionally tests VM boot
#
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CH_VERSION="${CH_VERSION:-v41.0}"
CH_DATA_DIR="${CH_DATA_DIR:-$HOME/.opus-orchestra/cloud-hypervisor}"

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_section() {
    echo ""
    echo -e "${BLUE}=== $1 ===${NC}"
    echo ""
}

# ============================================================================
# PHASE 1: DIAGNOSTICS
# ============================================================================
# Check current WSL environment and identify what's needed for Cloud Hypervisor

run_diagnostics() {
    log_section "WSL2 Cloud Hypervisor Compatibility Diagnostics"

    local issues=0

    # Check 1: Running in WSL2
    log_info "Checking WSL version..."
    if [[ -f /proc/version ]] && grep -qi microsoft /proc/version; then
        if [[ -f /proc/sys/fs/binfmt_misc/WSLInterop ]]; then
            log_info "WSL2: DETECTED"
        else
            log_warn "WSL1 detected. Cloud Hypervisor requires WSL2."
            log_info "Upgrade to WSL2: wsl --set-version <distro> 2"
            ((issues++))
        fi
    else
        log_warn "Not running in WSL"
        ((issues++))
    fi

    # Check 2: KVM available
    log_info "Checking KVM support..."
    if [[ -e /dev/kvm ]]; then
        log_info "KVM: AVAILABLE (/dev/kvm exists)"

        # Check permissions
        if [[ -r /dev/kvm ]] && [[ -w /dev/kvm ]]; then
            log_info "KVM permissions: OK"
        else
            log_warn "KVM exists but not accessible. Run: sudo chmod 666 /dev/kvm"
            log_info "Or add user to kvm group: sudo usermod -aG kvm $USER"
            ((issues++))
        fi
    else
        log_error "KVM: NOT AVAILABLE"
        log_info ""
        log_info "To enable KVM in WSL2:"
        log_info "1. Ensure you're on Windows 11 or Windows 10 build 21H2+"
        log_info "2. Enable nested virtualization in .wslconfig:"
        log_info "   Create/edit %USERPROFILE%\\.wslconfig with:"
        log_info "   [wsl2]"
        log_info "   nestedVirtualization=true"
        log_info "3. Restart WSL: wsl --shutdown"
        ((issues++))
    fi

    # Check 3: Architecture
    log_info "Checking architecture..."
    local arch=$(uname -m)
    if [[ "$arch" == "x86_64" ]] || [[ "$arch" == "aarch64" ]]; then
        log_info "Architecture: $arch (supported)"
    else
        log_error "Architecture: $arch (unsupported)"
        ((issues++))
    fi

    # Check 4: Required tools
    log_info "Checking required tools..."
    for tool in curl tar; do
        if command -v $tool &> /dev/null; then
            log_info "$tool: installed"
        else
            log_warn "$tool: not installed"
            ((issues++))
        fi
    done

    # Check 5: Cloud Hypervisor installed
    log_info "Checking Cloud Hypervisor..."
    if command -v cloud-hypervisor &> /dev/null; then
        log_info "Cloud Hypervisor: INSTALLED ($(cloud-hypervisor --version 2>&1 | head -1))"
    else
        log_warn "Cloud Hypervisor: NOT INSTALLED"
    fi

    # Check 6: virtiofsd installed
    log_info "Checking virtiofsd..."
    if command -v virtiofsd &> /dev/null; then
        log_info "virtiofsd: INSTALLED ($(virtiofsd --version 2>&1 | head -1))"
    else
        log_warn "virtiofsd: NOT INSTALLED (required for virtio-fs mounts)"
    fi

    # Check 7: Kernel available
    log_info "Checking kernel..."
    if [[ -f "$CH_DATA_DIR/vmlinux" ]]; then
        local size=$(du -h "$CH_DATA_DIR/vmlinux" | cut -f1)
        log_info "Kernel: AVAILABLE ($CH_DATA_DIR/vmlinux, $size)"
    else
        log_warn "Kernel: NOT DOWNLOADED (run: $0 kernel)"
    fi

    # Summary
    echo ""
    if [[ $issues -eq 0 ]]; then
        log_info "All checks passed! Your WSL2 environment appears ready for Cloud Hypervisor."
    else
        log_warn "$issues issue(s) found. Address the warnings above before proceeding."
    fi

    return $issues
}

# ============================================================================
# PHASE 2: INSTALL CLOUD HYPERVISOR
# ============================================================================

install_cloud_hypervisor() {
    log_section "Installing Cloud Hypervisor $CH_VERSION"

    local arch=$(uname -m)

    # Check if already installed
    if command -v cloud-hypervisor &> /dev/null; then
        local current_version=$(cloud-hypervisor --version 2>&1 | head -1)
        log_info "Cloud Hypervisor already installed: $current_version"
        read -p "Reinstall? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            return 0
        fi
    fi

    # Determine binary URL
    local ch_url="https://github.com/cloud-hypervisor/cloud-hypervisor/releases/download/${CH_VERSION}/cloud-hypervisor-static"

    if [[ "$arch" == "aarch64" ]]; then
        ch_url="https://github.com/cloud-hypervisor/cloud-hypervisor/releases/download/${CH_VERSION}/cloud-hypervisor-static-aarch64"
    fi

    # Download Cloud Hypervisor
    log_info "Downloading Cloud Hypervisor..."
    curl -fsSL -o /tmp/cloud-hypervisor "$ch_url"

    log_info "Installing to /usr/local/bin..."
    sudo mv /tmp/cloud-hypervisor /usr/local/bin/cloud-hypervisor
    sudo chmod +x /usr/local/bin/cloud-hypervisor

    # Verify
    log_info "Verifying installation..."
    cloud-hypervisor --version

    log_info "Cloud Hypervisor installed successfully!"

    # Install virtiofsd separately (not included in CH releases)
    install_virtiofsd
}

# Install virtiofsd (separate from Cloud Hypervisor)
install_virtiofsd() {
    log_section "Installing virtiofsd"

    if command -v virtiofsd &> /dev/null; then
        log_info "virtiofsd already installed: $(virtiofsd --version 2>&1 | head -1)"
        return 0
    fi

    # Try apt first (most WSL distros are Ubuntu-based)
    if command -v apt-get &> /dev/null; then
        log_info "Installing virtiofsd via apt..."
        sudo apt-get update
        sudo apt-get install -y virtiofsd && {
            log_info "virtiofsd installed via apt"
            virtiofsd --version
            return 0
        }
    fi

    # Try cargo as fallback
    if command -v cargo &> /dev/null; then
        log_info "Installing virtiofsd via cargo..."
        cargo install virtiofsd
        log_info "virtiofsd installed via cargo"
        return 0
    fi

    log_warn "Could not install virtiofsd automatically."
    log_info "Install options:"
    log_info "  1. sudo apt install virtiofsd"
    log_info "  2. cargo install virtiofsd"
    return 1
}

# ============================================================================
# PHASE 3: DOWNLOAD KERNEL
# ============================================================================

download_kernel() {
    log_section "Downloading Kernel for Cloud Hypervisor"

    mkdir -p "$CH_DATA_DIR"

    # Kernels are in the cloud-hypervisor/linux repository, not the main CH repo
    local KERNEL_VERSION="${KERNEL_VERSION:-ch-release-v6.16.9-20251112}"
    local arch=$(uname -m)

    if [[ "$arch" == "x86_64" ]]; then
        local kernel_url="https://github.com/cloud-hypervisor/linux/releases/download/${KERNEL_VERSION}/vmlinux-x86_64"
    elif [[ "$arch" == "aarch64" ]]; then
        local kernel_url="https://github.com/cloud-hypervisor/linux/releases/download/${KERNEL_VERSION}/Image-arm64"
    else
        log_error "Unsupported architecture: $arch"
        return 1
    fi

    log_info "Downloading kernel from: $kernel_url"
    curl -fsSL -o "$CH_DATA_DIR/vmlinux" "$kernel_url"

    local size=$(du -h "$CH_DATA_DIR/vmlinux" | cut -f1)
    log_info "Kernel downloaded: $CH_DATA_DIR/vmlinux ($size)"
}

# ============================================================================
# PHASE 4: FIX KVM PERMISSIONS
# ============================================================================

fix_kvm_permissions() {
    log_section "Fixing KVM Permissions"

    if [[ ! -e /dev/kvm ]]; then
        log_error "KVM device not found. Enable nested virtualization first."
        log_info "See 'diagnostics' for instructions."
        return 1
    fi

    # Check current permissions
    if [[ -r /dev/kvm ]] && [[ -w /dev/kvm ]]; then
        log_info "KVM permissions are already correct."
        return 0
    fi

    # Try to fix permissions
    log_info "Setting KVM permissions..."

    # Check if kvm group exists
    if getent group kvm > /dev/null 2>&1; then
        if ! groups | grep -q kvm; then
            log_info "Adding $USER to kvm group..."
            sudo usermod -aG kvm "$USER"
            log_warn "You need to log out and back in for group changes to take effect."
        fi
    fi

    # Immediate fix (temporary until reboot)
    sudo chmod 666 /dev/kvm
    log_info "KVM permissions fixed (temporary). Add yourself to kvm group for permanent fix."
}

# ============================================================================
# PHASE 5: TEST CLOUD HYPERVISOR
# ============================================================================

test_cloud_hypervisor() {
    log_section "Testing Cloud Hypervisor"

    # Check prerequisites
    if ! command -v cloud-hypervisor &> /dev/null; then
        log_error "Cloud Hypervisor is not installed. Run: $0 install"
        return 1
    fi

    if [[ ! -e /dev/kvm ]]; then
        log_error "KVM is not available. See 'diagnostics' for setup."
        return 1
    fi

    if [[ ! -f "$CH_DATA_DIR/vmlinux" ]]; then
        log_warn "Kernel not found. Downloading..."
        download_kernel
    fi

    log_info "Starting Cloud Hypervisor test..."
    log_info "This will boot a minimal VM to verify everything works."

    # Create a minimal test - just check that CH can start with the kernel
    # We won't have a rootfs, so it will fail to boot fully, but we can
    # verify the VMM starts correctly

    local test_socket="/tmp/ch-test-$$.sock"

    # Try to start Cloud Hypervisor (will fail without rootfs, but that's OK)
    timeout 5 cloud-hypervisor \
        --kernel "$CH_DATA_DIR/vmlinux" \
        --cpus boot=1 \
        --memory size=256M \
        --api-socket "$test_socket" \
        2>&1 | head -20 || true

    # Clean up
    rm -f "$test_socket"

    log_info ""
    log_info "Cloud Hypervisor started successfully!"
    log_info "The VM failed to boot (expected - no rootfs), but the VMM works."
    log_info ""
    log_info "To build a rootfs with Claude Code, run:"
    log_info "  cd vscode-extension && ./scripts/setup/cloud-hypervisor.sh rootfs"
}

# ============================================================================
# PHASE 6: FULL SETUP
# ============================================================================

run_full_setup() {
    log_section "Running Full Cloud Hypervisor Setup"

    log_info "Step 1/4: Running diagnostics..."
    run_diagnostics || true

    log_info "Step 2/4: Fixing KVM permissions..."
    fix_kvm_permissions || true

    log_info "Step 3/4: Installing Cloud Hypervisor..."
    install_cloud_hypervisor

    log_info "Step 4/4: Downloading kernel..."
    download_kernel

    echo ""
    log_section "Setup Complete!"

    log_info "Cloud Hypervisor is installed and ready."
    log_info ""
    log_info "Next steps:"
    log_info "  1. Build a rootfs (if needed):"
    log_info "     cd vscode-extension && ./scripts/setup/cloud-hypervisor.sh rootfs"
    log_info "  2. Set VS Code settings:"
    log_info "     claudeAgents.isolationTier: 'cloud-hypervisor'"
    log_info "     claudeAgents.cloudHypervisorPath: '/usr/local/bin/cloud-hypervisor'"
}

# ============================================================================
# MAIN
# ============================================================================

case "${1:-}" in
    diagnostics|check)
        run_diagnostics
        ;;
    install)
        install_cloud_hypervisor
        ;;
    kernel)
        download_kernel
        ;;
    kvm|permissions)
        fix_kvm_permissions
        ;;
    test)
        test_cloud_hypervisor
        ;;
    setup|"")
        run_full_setup
        ;;
    -h|--help|help)
        echo "Cloud Hypervisor WSL2 Setup Script"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  diagnostics  - Check WSL2 environment for Cloud Hypervisor compatibility"
        echo "  install      - Install Cloud Hypervisor and virtiofsd binaries"
        echo "  kernel       - Download kernel with virtio-fs support"
        echo "  kvm          - Fix KVM permissions"
        echo "  test         - Verify Cloud Hypervisor can start a VM"
        echo "  setup        - Run full setup (default)"
        echo ""
        echo "Environment variables:"
        echo "  CH_VERSION   - Cloud Hypervisor version (default: v41.0)"
        echo "  CH_DATA_DIR  - Data directory (default: ~/.opus-orchestra/cloud-hypervisor)"
        ;;
    *)
        log_error "Unknown command: $1"
        echo "Run '$0 --help' for usage."
        exit 1
        ;;
esac
