#!/bin/bash
# =============================================================================
# Firecracker WSL2 Setup Script
# =============================================================================
#
# This script configures WSL2 to support Firecracker microVMs.
#
# Based on the guide by Mikhail Veltishchev:
# https://medium.com/@veltun/configuring-wsl2-to-support-firecracker-vms-i-e-for-containerlab-a3d36ca8ed8a
#
# Additional resources:
# - https://boxofcables.dev/kvm-optimized-custom-kernel-wsl2-2022/
# - https://boxofcables.dev/how-to-build-a-custom-kernel-for-wsl-in-2025/
# - https://firecracker-microvm.github.io/
# - https://github.com/firecracker-microvm/firecracker/blob/main/docs/rootfs-and-kernel-setup.md
# - https://github.com/weaveworks/ignite/issues/129 (DM_SNAPSHOT requirements)
# - https://github.com/microsoft/WSL/issues/4193 (WSL2 nested virtualization)
#
# =============================================================================
#
# SECURITY CONSIDERATIONS FOR WSL2 FIRECRACKER SETUP
# ===================================================
#
# Running Firecracker on WSL2 involves multiple virtualization layers.
# Here's what you should understand about the security model:
#
# 1. VIRTUALIZATION STACK
#    Windows Host -> Hyper-V -> WSL2 VM -> KVM -> Firecracker microVM
#
#    This is "nested virtualization" - VMs running inside VMs. Each layer
#    provides isolation, but also adds complexity.
#
# 2. FIRECRACKER'S SECURITY MODEL
#    Firecracker was designed by AWS for Lambda/Fargate with security as
#    a primary goal:
#    - Minimal device model (reduced attack surface vs QEMU)
#    - Written in Rust (memory safety)
#    - Uses KVM for hardware-level isolation
#    - "Jailer" companion provides additional sandboxing via:
#      * seccomp filters (syscall restrictions)
#      * cgroups (resource limits)
#      * namespaces (isolation)
#
# 3. WSL2-SPECIFIC SECURITY DIFFERENCES
#
#    vs Native Linux:
#    - WSL2 runs in a lightweight Hyper-V VM, adding an extra isolation layer
#    - The WSL2 kernel is Microsoft-maintained with a reduced feature set
#    - /dev/kvm access grants significant privileges within WSL2
#
#    Potential concerns:
#    - Nested virtualization performance overhead
#    - Custom kernels (if you compile one) won't get automatic MS updates
#    - The kvm group membership grants VM creation ability to that user
#
# 4. RECOMMENDATIONS
#    - Only add trusted users to the 'kvm' group
#    - Use the jailer for production workloads (provides seccomp + cgroups)
#    - Keep your custom kernel updated if you compile one
#    - For high-security needs, consider native Linux instead of WSL2
#    - The extra Hyper-V layer actually provides ADDITIONAL isolation from
#      Windows, which can be seen as a security benefit
#
# 5. WHAT THIS SCRIPT DOES
#    - Adds user to 'kvm' group (required for /dev/kvm access)
#    - Installs firecracker + jailer binaries
#    - Optionally compiles a custom kernel (for CONFIG_DM_SNAPSHOT)
#
#    None of these operations weaken your system's security posture
#    beyond what's inherent in running virtual machines.
#
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()    { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
log_section() { echo -e "\n${BLUE}=== $1 ===${NC}\n"; }

# =============================================================================
# PHASE 1: DIAGNOSTICS
# =============================================================================
# Check current WSL environment and identify what's needed for Firecracker

run_diagnostics() {
    log_section "WSL2 Firecracker Compatibility Diagnostics"

    local issues_found=0

    # Check 1: Kernel version
    log_info "Kernel version: $(uname -r)"

    # Check 2: CPU vendor (determines KVM module: kvm_intel vs kvm_amd)
    local cpu_vendor=$(grep -m1 'vendor_id' /proc/cpuinfo | cut -d: -f2 | tr -d ' ')
    local cpu_model=$(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | sed 's/^ *//')
    log_info "CPU: $cpu_model ($cpu_vendor)"

    if [[ "$cpu_vendor" == "GenuineIntel" ]]; then
        KVM_MODULE="kvm_intel"
    elif [[ "$cpu_vendor" == "AuthenticAMD" ]]; then
        KVM_MODULE="kvm_amd"
    else
        log_error "Unknown CPU vendor: $cpu_vendor"
        ((issues_found++))
    fi

    # Check 3: /dev/kvm exists and is accessible
    echo ""
    if [[ -e /dev/kvm ]]; then
        log_info "/dev/kvm: EXISTS"
        ls -la /dev/kvm

        # Check if user has permission to access /dev/kvm
        if [[ -r /dev/kvm ]] && [[ -w /dev/kvm ]]; then
            log_info "/dev/kvm permissions: OK (read/write access)"
        else
            log_warn "/dev/kvm permissions: DENIED"
            local kvm_group=$(stat -c '%G' /dev/kvm)
            if groups | grep -qw "$kvm_group"; then
                log_warn "  You are in the '$kvm_group' group but still lack access."
                log_warn "  Try: newgrp $kvm_group  (or log out and back in)"
            else
                log_warn "  You are NOT in the '$kvm_group' group."
                log_warn "  Fix with: sudo usermod -aG $kvm_group \$USER"
                log_warn "  Then log out and back in (or: wsl --shutdown)"
            fi
            ((issues_found++))
        fi
    else
        log_error "/dev/kvm: NOT FOUND"
        log_warn "  KVM device not available. Check that:"
        log_warn "  1. Virtualization is enabled in BIOS (Intel VT-x / AMD-V)"
        log_warn "  2. Nested virtualization is enabled in .wslconfig"
        ((issues_found++))
    fi

    # Check 4: Nested virtualization
    echo ""
    local nested_param="/sys/module/${KVM_MODULE}/parameters/nested"
    if [[ -f "$nested_param" ]]; then
        local nested_val=$(cat "$nested_param")
        if [[ "$nested_val" == "Y" || "$nested_val" == "1" ]]; then
            log_info "Nested virtualization: ENABLED"
        else
            log_warn "Nested virtualization: DISABLED"
            log_warn "  Add to C:\\Users\\<USER>\\.wslconfig:"
            log_warn "  [wsl2]"
            log_warn "  nestedVirtualization=true"
            ((issues_found++))
        fi
    else
        log_warn "Nested virtualization: UNKNOWN (module not loaded)"
        ((issues_found++))
    fi

    # Check 5: KVM modules loaded
    echo ""
    log_info "KVM modules:"
    if lsmod | grep -q kvm; then
        lsmod | grep kvm | sed 's/^/  /'
    else
        log_info "  KVM built into kernel (not as modules)"
    fi

    # Check 6: Kernel config for required features
    echo ""
    log_info "Kernel configuration (from /proc/config.gz):"

    if [[ -f /proc/config.gz ]]; then
        # KVM support
        local kvm_config=$(zcat /proc/config.gz | grep "^CONFIG_KVM=" || echo "NOT SET")
        local kvm_intel=$(zcat /proc/config.gz | grep "^CONFIG_KVM_INTEL=" || echo "NOT SET")
        local kvm_amd=$(zcat /proc/config.gz | grep "^CONFIG_KVM_AMD=" || echo "NOT SET")

        echo "  $kvm_config"
        echo "  $kvm_intel"
        echo "  $kvm_amd"

        # Device mapper (needed for containerlab/ignite)
        local dm_snapshot=$(zcat /proc/config.gz | grep "CONFIG_DM_SNAPSHOT" || echo "NOT SET")
        echo "  $dm_snapshot"

        if [[ "$dm_snapshot" == *"is not set"* || "$dm_snapshot" == "NOT SET" ]]; then
            log_warn ""
            log_warn "CONFIG_DM_SNAPSHOT is not enabled!"
            log_warn "This is required for containerlab and some Firecracker use cases."
            log_warn "You will need to compile a custom WSL2 kernel."
            ((issues_found++))
        fi
    else
        log_warn "  /proc/config.gz not available"
        ((issues_found++))
    fi

    # Check 7: Firecracker installed
    echo ""
    if command -v firecracker &> /dev/null; then
        log_info "Firecracker: INSTALLED ($(firecracker --version 2>&1 | head -1))"
    else
        log_warn "Firecracker: NOT INSTALLED"
    fi

    # Summary
    echo ""
    log_section "Diagnostic Summary"
    if [[ $issues_found -eq 0 ]]; then
        log_info "All checks passed! Your WSL2 environment appears ready for Firecracker."
    else
        log_warn "Found $issues_found potential issue(s). Review the warnings above."
    fi

    return $issues_found
}

# =============================================================================
# PHASE 2: INSTALL FIRECRACKER
# =============================================================================
# Downloads and installs the latest Firecracker binaries

FIRECRACKER_VERSION="${FIRECRACKER_VERSION:-v1.13.1}"

install_firecracker() {
    log_section "Installing Firecracker $FIRECRACKER_VERSION"

    local arch=$(uname -m)
    local release_url="https://github.com/firecracker-microvm/firecracker/releases"
    local tmp_dir="/tmp/firecracker-install"

    # Check if already installed
    if command -v firecracker &> /dev/null; then
        local current_version=$(firecracker --version 2>&1 | head -1)
        log_info "Firecracker already installed: $current_version"
        read -p "Reinstall? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Skipping installation."
            return 0
        fi
    fi

    # Create temp directory
    mkdir -p "$tmp_dir"
    cd "$tmp_dir"

    # Download
    local tarball="firecracker-${FIRECRACKER_VERSION}-${arch}.tgz"
    local download_url="${release_url}/download/${FIRECRACKER_VERSION}/${tarball}"

    log_info "Downloading from: $download_url"
    curl -L "$download_url" -o "$tarball"

    # Extract
    log_info "Extracting..."
    tar -xzf "$tarball"

    local release_dir="release-${FIRECRACKER_VERSION}-${arch}"

    # Install binaries (requires sudo)
    log_info "Installing binaries to /usr/local/bin/ (requires sudo)..."

    sudo cp "${release_dir}/firecracker-${FIRECRACKER_VERSION}-${arch}" /usr/local/bin/firecracker
    sudo cp "${release_dir}/jailer-${FIRECRACKER_VERSION}-${arch}" /usr/local/bin/jailer
    sudo chmod +x /usr/local/bin/firecracker /usr/local/bin/jailer

    # Verify installation
    log_info "Verifying installation..."
    firecracker --version

    # Cleanup
    log_info "Cleaning up..."
    rm -rf "$tmp_dir"

    log_info "Firecracker installed successfully!"

    # Check KVM access
    echo ""
    if [[ -e /dev/kvm ]]; then
        if [[ -r /dev/kvm ]] && [[ -w /dev/kvm ]]; then
            log_info "KVM access: OK"
        else
            log_warn "KVM device exists but you may not have permission."
            log_warn "Add yourself to the kvm group: sudo usermod -aG kvm \$USER"
            log_warn "Then log out and back in."
        fi
    else
        log_error "KVM device /dev/kvm not found!"
        log_warn "Firecracker requires KVM. See 'diagnostics' for more info."
    fi
}

# =============================================================================
# PHASE 3: FIX KVM PERMISSIONS
# =============================================================================
# Adds the current user to the kvm group for /dev/kvm access

fix_kvm_permissions() {
    log_section "Fixing KVM Permissions"

    local kvm_group=$(stat -c '%G' /dev/kvm 2>/dev/null || echo "kvm")

    if [[ ! -e /dev/kvm ]]; then
        log_error "/dev/kvm does not exist!"
        log_warn "KVM is not available. Check BIOS virtualization settings"
        log_warn "and ensure nestedVirtualization=true in .wslconfig"
        return 1
    fi

    if [[ -r /dev/kvm ]] && [[ -w /dev/kvm ]]; then
        log_info "You already have read/write access to /dev/kvm"
        return 0
    fi

    if groups | grep -qw "$kvm_group"; then
        log_warn "You are in the '$kvm_group' group but don't have access yet."
        log_info "This usually means you need to refresh your group membership."
        echo ""
        log_info "Options:"
        log_info "  1. Run: newgrp $kvm_group"
        log_info "  2. Or restart WSL: wsl --shutdown (from PowerShell)"
        return 0
    fi

    log_info "Adding $USER to the '$kvm_group' group..."
    sudo usermod -aG "$kvm_group" "$USER"

    if [[ $? -eq 0 ]]; then
        log_info "Successfully added $USER to '$kvm_group' group!"
        echo ""
        log_warn "You need to refresh your group membership:"
        log_info "  Option 1: Run 'newgrp $kvm_group' in this terminal"
        log_info "  Option 2: Restart WSL with 'wsl --shutdown' from PowerShell"
    else
        log_error "Failed to add user to $kvm_group group"
        return 1
    fi
}

# =============================================================================
# PHASE 4: TEST FIRECRACKER
# =============================================================================
# Downloads test images and boots a quick VM to verify everything works

TEST_DIR="/tmp/firecracker-test"
IMAGE_BUCKET_URL="https://s3.amazonaws.com/spec.ccfc.min/img"

test_firecracker() {
    log_section "Testing Firecracker"

    # Pre-flight checks
    if ! command -v firecracker &> /dev/null; then
        log_error "Firecracker is not installed. Run: $0 install"
        return 1
    fi

    if [[ ! -e /dev/kvm ]]; then
        log_error "/dev/kvm not found. KVM is required."
        return 1
    fi

    if [[ ! -r /dev/kvm ]] || [[ ! -w /dev/kvm ]]; then
        log_error "No permission to access /dev/kvm"
        log_warn "Run: $0 fix-kvm"
        return 1
    fi

    # Clean up any previous test
    pkill -9 firecracker 2>/dev/null || true
    rm -f /tmp/firecracker.socket

    # Create test directory
    mkdir -p "$TEST_DIR"
    cd "$TEST_DIR"

    # Download test images if not present
    if [[ ! -f "$TEST_DIR/hello-vmlinux.bin" ]]; then
        log_info "Downloading test kernel..."
        curl -fsSL -o hello-vmlinux.bin "${IMAGE_BUCKET_URL}/quickstart_guide/x86_64/kernels/vmlinux.bin"
    else
        log_info "Using cached test kernel"
    fi

    if [[ ! -f "$TEST_DIR/hello-rootfs.ext4" ]]; then
        log_info "Downloading test rootfs..."
        curl -fsSL -o hello-rootfs.ext4 "${IMAGE_BUCKET_URL}/hello/fsfiles/hello-rootfs.ext4"
    else
        log_info "Using cached test rootfs"
    fi

    # Start Firecracker
    log_info "Starting Firecracker..."
    firecracker --api-sock /tmp/firecracker.socket > /tmp/fc-test.log 2>&1 &
    local fc_pid=$!
    sleep 0.5

    if [[ ! -S /tmp/firecracker.socket ]]; then
        log_error "Firecracker failed to start. Check /tmp/fc-test.log"
        return 1
    fi

    # Configure VM
    log_info "Configuring VM..."

    # Set kernel
    curl -s --unix-socket /tmp/firecracker.socket -X PUT "http://localhost/boot-source" \
        -H "Content-Type: application/json" \
        -d "{
            \"kernel_image_path\": \"$TEST_DIR/hello-vmlinux.bin\",
            \"boot_args\": \"console=ttyS0 reboot=k panic=1 pci=off\"
        }"

    # Set rootfs
    curl -s --unix-socket /tmp/firecracker.socket -X PUT "http://localhost/drives/rootfs" \
        -H "Content-Type: application/json" \
        -d "{
            \"drive_id\": \"rootfs\",
            \"path_on_host\": \"$TEST_DIR/hello-rootfs.ext4\",
            \"is_root_device\": true,
            \"is_read_only\": false
        }"

    # Start VM
    log_info "Starting microVM..."
    local start_response=$(curl -s --unix-socket /tmp/firecracker.socket -X PUT "http://localhost/actions" \
        -H "Content-Type: application/json" \
        -d '{"action_type": "InstanceStart"}')

    if echo "$start_response" | grep -q "fault_message"; then
        log_error "Failed to start VM:"
        echo "$start_response" | sed 's/^/  /'
        kill $fc_pid 2>/dev/null
        return 1
    fi

    # Wait for boot and check
    log_info "Waiting for VM to boot..."
    sleep 3

    if grep -q "Welcome to Alpine Linux" /tmp/fc-test.log 2>/dev/null; then
        log_info "VM booted successfully!"
        echo ""
        log_info "Boot log (last 10 lines):"
        tail -10 /tmp/fc-test.log | sed 's/^/  /'
        echo ""
        log_info "Firecracker is working correctly on your WSL2 setup!"
    else
        log_warn "VM may not have fully booted. Check /tmp/fc-test.log"
        tail -20 /tmp/fc-test.log | sed 's/^/  /'
    fi

    # Cleanup
    log_info "Stopping test VM..."
    kill $fc_pid 2>/dev/null
    rm -f /tmp/firecracker.socket

    return 0
}

# =============================================================================
# MAIN
# =============================================================================

run_all() {
    log_section "Running Full Firecracker Setup"

    log_info "Step 1/4: Running diagnostics..."
    run_diagnostics || true  # Continue even if issues found
    echo ""

    log_info "Step 2/4: Fixing KVM permissions..."
    fix_kvm_permissions || true
    echo ""

    log_info "Step 3/4: Installing Firecracker..."
    install_firecracker
    echo ""

    # Check if we have KVM access before testing
    if [[ -r /dev/kvm ]] && [[ -w /dev/kvm ]]; then
        log_info "Step 4/4: Testing Firecracker..."
        test_firecracker
    else
        log_warn "Step 4/4: Skipping test (no KVM access yet)"
        log_warn "Run 'newgrp kvm' or restart WSL, then run: $0 test"
    fi

    echo ""
    log_section "Setup Complete"
    log_info "Firecracker is installed and ready."
    log_info ""
    log_info "If you haven't already, refresh your group membership:"
    log_info "  newgrp kvm"
    log_info ""
    log_info "Then test with:"
    log_info "  $0 test"
}

case "${1:-diagnostics}" in
    diagnostics|diag|check)
        run_diagnostics
        ;;
    install)
        install_firecracker
        ;;
    fix-kvm|fix-permissions|fixkvm)
        fix_kvm_permissions
        ;;
    test)
        test_firecracker
        ;;
    all|setup)
        run_all
        ;;
    *)
        echo "Usage: $0 {all|diagnostics|install|fix-kvm|test}"
        echo ""
        echo "Commands:"
        echo "  all          - Run full setup (diagnostics + fix-kvm + install + test)"
        echo "  diagnostics  - Check WSL2 environment for Firecracker compatibility"
        echo "  install      - Install Firecracker binaries"
        echo "  fix-kvm      - Fix /dev/kvm permissions (add user to kvm group)"
        echo "  test         - Boot a test VM to verify Firecracker works"
        exit 1
        ;;
esac
