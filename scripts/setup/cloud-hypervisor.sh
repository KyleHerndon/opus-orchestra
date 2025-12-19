#!/bin/bash
# Cloud Hypervisor setup for Opus Orchestra
#
# Cloud Hypervisor provides hardware-level VM isolation using KVM,
# with virtio-fs support for fast file mounting from host to guest.
#
# Requirements:
#   - Linux with KVM support
#   - /dev/kvm accessible
#
# Usage:
#   ./cloud-hypervisor.sh         # Install Cloud Hypervisor + virtiofsd
#   ./cloud-hypervisor.sh check   # Check status
#   ./cloud-hypervisor.sh kernel  # Download kernel only
#   ./cloud-hypervisor.sh rootfs  # Build rootfs only

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

CH_VERSION="${CH_VERSION:-v41.0}"

# Use the real user's home even when running with sudo
if [[ -n "$SUDO_USER" ]]; then
    REAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
else
    REAL_HOME="$HOME"
fi
CH_DATA_DIR="${CH_DATA_DIR:-$REAL_HOME/.opus-orchestra/cloud-hypervisor}"

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

# Check Cloud Hypervisor installation
check_cloud_hypervisor() {
    if command_exists cloud-hypervisor; then
        local version=$(cloud-hypervisor --version 2>&1 | head -1)
        print_status "ok" "Cloud Hypervisor" "$version"
        return 0
    else
        print_status "error" "Cloud Hypervisor" "not installed"
        return 1
    fi
}

# Check virtiofsd installation
check_virtiofsd() {
    if command_exists virtiofsd; then
        local version=$(virtiofsd --version 2>&1 | head -1)
        print_status "ok" "virtiofsd" "$version"
        return 0
    else
        print_status "warn" "virtiofsd" "not installed (required for virtio-fs mounts)"
        return 1
    fi
}

# Check kernel availability
check_kernel() {
    if [[ -f "$CH_DATA_DIR/vmlinux" ]]; then
        local size=$(du -h "$CH_DATA_DIR/vmlinux" | cut -f1)
        print_status "ok" "Kernel" "$CH_DATA_DIR/vmlinux ($size)"
        return 0
    else
        print_status "warn" "Kernel" "not downloaded"
        return 1
    fi
}

# Check rootfs availability
check_rootfs() {
    if [[ -f "$CH_DATA_DIR/rootfs.ext4" ]]; then
        local size=$(du -h "$CH_DATA_DIR/rootfs.ext4" | cut -f1)
        print_status "ok" "Root filesystem" "$CH_DATA_DIR/rootfs.ext4 ($size)"
        return 0
    else
        print_status "warn" "Root filesystem" "not created (run: $0 rootfs)"
        return 1
    fi
}

# Download Cloud Hypervisor binary
download_cloud_hypervisor() {
    print_section "Downloading Cloud Hypervisor ${CH_VERSION}..."

    local url="https://github.com/cloud-hypervisor/cloud-hypervisor/releases/download/${CH_VERSION}/cloud-hypervisor-static"

    if [[ "$ARCH" == "aarch64" ]]; then
        url="https://github.com/cloud-hypervisor/cloud-hypervisor/releases/download/${CH_VERSION}/cloud-hypervisor-static-aarch64"
    fi

    echo "Downloading from: $url"
    curl -fsSL -o /tmp/cloud-hypervisor "$url"

    echo "Installing binary..."
    require_sudo mv /tmp/cloud-hypervisor /usr/local/bin/cloud-hypervisor
    require_sudo chmod +x /usr/local/bin/cloud-hypervisor

    print_status "ok" "Cloud Hypervisor installed" "/usr/local/bin/cloud-hypervisor"
}

# Install virtiofsd
install_virtiofsd() {
    print_section "Installing virtiofsd..."

    # virtiofsd is available via package managers or cargo
    # Try package manager first, fall back to cargo
    if [[ "$OS" == "linux" ]] || [[ "$OS" == "wsl" ]]; then
        # Check if available via apt
        if command_exists apt-get; then
            echo "Installing virtiofsd via apt..."
            require_sudo apt-get update
            require_sudo apt-get install -y virtiofsd && {
                print_status "ok" "virtiofsd installed" "via apt"
                return 0
            }
        fi
    fi

    # Fall back to cargo
    if command_exists cargo; then
        echo "Installing virtiofsd via cargo..."
        cargo install virtiofsd
        print_status "ok" "virtiofsd installed" "via cargo"
    else
        echo ""
        echo "virtiofsd installation options:"
        echo "  1. Install via package manager: sudo apt install virtiofsd"
        echo "  2. Install Rust and run: cargo install virtiofsd"
        echo ""
        print_status "warn" "virtiofsd" "not installed - install manually"
        return 1
    fi
}

# Download kernel
download_kernel() {
    print_section "Downloading kernel..."

    mkdir -p "$CH_DATA_DIR"
    # Fix directory ownership if running with sudo
    if [[ -n "$SUDO_USER" ]]; then
        chown "$SUDO_USER:$SUDO_USER" "$REAL_HOME/.opus-orchestra" "$CH_DATA_DIR"
    fi

    # Kernels are in the cloud-hypervisor/linux repository, not the main CH repo
    # Use the latest kernel release with virtio-fs support
    local KERNEL_VERSION="${KERNEL_VERSION:-ch-release-v6.16.9-20251112}"

    if [[ "$ARCH" == "x86_64" ]]; then
        local kernel_url="https://github.com/cloud-hypervisor/linux/releases/download/${KERNEL_VERSION}/vmlinux-x86_64"
    elif [[ "$ARCH" == "aarch64" ]]; then
        local kernel_url="https://github.com/cloud-hypervisor/linux/releases/download/${KERNEL_VERSION}/Image-arm64"
    else
        echo "Unsupported architecture: $ARCH"
        return 1
    fi

    echo "Downloading kernel from: $kernel_url"
    curl -fsSL -o "$CH_DATA_DIR/vmlinux" "$kernel_url"

    # Fix ownership so non-root user can use the kernel
    if [[ -n "$SUDO_USER" ]]; then
        chown "$SUDO_USER:$SUDO_USER" "$CH_DATA_DIR/vmlinux"
    fi

    local size=$(du -h "$CH_DATA_DIR/vmlinux" | cut -f1)
    print_status "ok" "Kernel downloaded" "$CH_DATA_DIR/vmlinux ($size)"
}

# Build rootfs with Claude Code pre-installed
build_rootfs() {
    print_section "Building root filesystem..."

    local ROOTFS_SIZE="${ROOTFS_SIZE:-2048}"  # 2GB default
    local ALPINE_VERSION="3.19"
    local ROOTFS_PATH="$CH_DATA_DIR/rootfs.ext4"
    local MOUNT_DIR="/tmp/ch-rootfs-$$"
    local ALPINE_TAR="/tmp/alpine-minirootfs.tar.gz"

    # Clean up any stale mounts from previous interrupted builds
    if mountpoint -q "$ROOTFS_PATH" 2>/dev/null || grep -q "$ROOTFS_PATH" /proc/mounts 2>/dev/null; then
        echo "Cleaning up stale mount of rootfs..."
        require_sudo umount "$ROOTFS_PATH" 2>/dev/null || true
    fi
    # Clean up any stale /tmp/ch-rootfs-* mount directories
    for stale_mount in /tmp/ch-rootfs-*; do
        if [[ -d "$stale_mount" ]] && mountpoint -q "$stale_mount" 2>/dev/null; then
            echo "Cleaning up stale mount at $stale_mount..."
            require_sudo umount "$stale_mount" 2>/dev/null || true
        fi
        [[ -d "$stale_mount" ]] && rmdir "$stale_mount" 2>/dev/null || true
    done

    # Remove old rootfs if it exists
    if [[ -f "$ROOTFS_PATH" ]]; then
        echo "Removing old rootfs..."
        rm -f "$ROOTFS_PATH"
    fi

    # Download Alpine minirootfs
    echo "Downloading Alpine Linux ${ALPINE_VERSION}..."
    local alpine_url="https://dl-cdn.alpinelinux.org/alpine/v${ALPINE_VERSION}/releases/${ARCH}/alpine-minirootfs-${ALPINE_VERSION}.0-${ARCH}.tar.gz"
    curl -fsSL -o "$ALPINE_TAR" "$alpine_url" || {
        echo "Failed to download Alpine. Trying latest release..."
        alpine_url="https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/${ARCH}/alpine-minirootfs-${ALPINE_VERSION}.0-${ARCH}.tar.gz"
        curl -fsSL -o "$ALPINE_TAR" "$alpine_url"
    }

    # Create ext4 image
    echo "Creating ${ROOTFS_SIZE}MB ext4 image..."
    mkdir -p "$CH_DATA_DIR"
    # Fix directory ownership if running with sudo
    if [[ -n "$SUDO_USER" ]]; then
        chown "$SUDO_USER:$SUDO_USER" "$REAL_HOME/.opus-orchestra" "$CH_DATA_DIR"
    fi
    dd if=/dev/zero of="$ROOTFS_PATH" bs=1M count="$ROOTFS_SIZE" status=progress
    mkfs.ext4 -F "$ROOTFS_PATH"

    # Mount and extract
    echo "Mounting and extracting Alpine..."
    mkdir -p "$MOUNT_DIR"
    require_sudo mount "$ROOTFS_PATH" "$MOUNT_DIR"

    require_sudo tar -xzf "$ALPINE_TAR" -C "$MOUNT_DIR"

    # Configure networking for chroot
    require_sudo cp /etc/resolv.conf "$MOUNT_DIR/etc/resolv.conf"

    # Install packages and configure system
    echo "Installing Node.js and Claude Code..."
    require_sudo chroot "$MOUNT_DIR" /bin/sh -c '
        # Setup repositories
        echo "https://dl-cdn.alpinelinux.org/alpine/v3.19/main" > /etc/apk/repositories
        echo "https://dl-cdn.alpinelinux.org/alpine/v3.19/community" >> /etc/apk/repositories

        # Install packages
        apk update
        apk add --no-cache nodejs npm git bash curl openrc util-linux mdev-conf

        # Set up basic device nodes
        mkdir -p /dev
        mknod -m 666 /dev/null c 1 3
        mknod -m 666 /dev/zero c 1 5
        mknod -m 666 /dev/random c 1 8
        mknod -m 666 /dev/urandom c 1 9
        mknod -m 666 /dev/tty c 5 0
        mknod -m 620 /dev/ttyS0 c 4 64
        mknod -m 620 /dev/console c 5 1
        ln -s /proc/self/fd /dev/fd
        ln -s /proc/self/fd/0 /dev/stdin
        ln -s /proc/self/fd/1 /dev/stdout
        ln -s /proc/self/fd/2 /dev/stderr

        # Enable mdev for dynamic device management
        rc-update add mdev sysinit 2>/dev/null || true

        # Install Claude Code globally (with progress)
        echo "Installing Claude Code (this may take a few minutes)..."
        npm install -g --loglevel info --progress @anthropic-ai/claude-code
        echo "Claude Code installation complete."

        # Create agent user
        adduser -D -s /bin/bash agent
        echo "agent:agent" | chpasswd

        # Configure auto-login on serial console as root (VM provides isolation)
        # Clear default getty entries and add our own
        sed -i "/^tty/d" /etc/inittab
        echo "ttyS0::respawn:/sbin/agetty --autologin root --noclear ttyS0 115200 vt100" >> /etc/inittab

        # Create network configuration script (runs at boot via local.d)
        mkdir -p /etc/local.d
        cat > /etc/local.d/network.start << "NETEOF"
#!/bin/sh
# Configure network from kernel boot args
# Format: VM_IP=x.x.x.x VM_GATEWAY=x.x.x.x VM_DNS=x.x.x.x

VM_IP=""
VM_GATEWAY=""
VM_DNS=""

for arg in $(cat /proc/cmdline); do
    case "$arg" in
        VM_IP=*) VM_IP="${arg#VM_IP=}" ;;
        VM_GATEWAY=*) VM_GATEWAY="${arg#VM_GATEWAY=}" ;;
        VM_DNS=*) VM_DNS="${arg#VM_DNS=}" ;;
    esac
done

if [ -n "$VM_IP" ]; then
    # Run network config in background to avoid blocking boot
    (
        # Wait for eth0 to appear (up to 30 seconds)
        # Use ip link instead of sysfs since /sys may not be mounted
        waited=0
        while ! ip link show eth0 >/dev/null 2>&1 && [ $waited -lt 30 ]; do
            sleep 1
            waited=$((waited + 1))
        done

        if ip link show eth0 >/dev/null 2>&1; then
            ip link set eth0 up
            ip addr add "${VM_IP}/24" dev eth0 2>/dev/null || true
            [ -n "$VM_GATEWAY" ] && ip route add default via "$VM_GATEWAY" 2>/dev/null || true
            [ -n "$VM_DNS" ] && echo "nameserver $VM_DNS" > /etc/resolv.conf
        fi
    ) &
fi
NETEOF
        chmod +x /etc/local.d/network.start
        rc-update add local default 2>/dev/null || true

        # Create boot-time mount script for virtio-fs (runs at boot via local.d)
        cat > /etc/local.d/virtiofs.start << "VFSEOF"
#!/bin/sh
# Mount virtio-fs filesystems from kernel boot args at boot time
# Format: VIRTIOFS_MOUNTS=workspace:/root/workspace,claude-config:/root/.claude

MOUNTS=""
for arg in $(cat /proc/cmdline); do
    case "$arg" in
        VIRTIOFS_MOUNTS=*) MOUNTS="${arg#VIRTIOFS_MOUNTS=}" ;;
    esac
done

if [ -n "$MOUNTS" ]; then
    # Split on comma using IFS (more portable than tr)
    OLD_IFS="$IFS"
    IFS=","
    for mount_spec in $MOUNTS; do
        TAG="${mount_spec%%:*}"
        MPATH="${mount_spec##*:}"
        if [ -n "$TAG" ] && [ -n "$MPATH" ]; then
            mkdir -p "$MPATH"
            mount -t virtiofs "$TAG" "$MPATH" 2>/dev/null && echo "Mounted $TAG at $MPATH" || true
        fi
    done
    IFS="$OLD_IFS"
fi
VFSEOF
        chmod +x /etc/local.d/virtiofs.start

        # Create profile mount script (fallback/re-mount for interactive shells)
        # Note: Uses simple shell parsing for BusyBox compatibility
        cat > /etc/profile.d/virtiofs-mount.sh << "MOUNTEOF"
#!/bin/sh
# Mount virtio-fs filesystems from kernel boot args
# Format: VIRTIOFS_MOUNTS=workspace:/home/agent/workspace,tools:/opt/tools

# Extract VIRTIOFS_MOUNTS value from kernel cmdline (BusyBox compatible)
MOUNTS=""
for arg in $(cat /proc/cmdline); do
    case "$arg" in
        VIRTIOFS_MOUNTS=*) MOUNTS="${arg#VIRTIOFS_MOUNTS=}" ;;
    esac
done

if [ -n "$MOUNTS" ]; then
    # Split on comma using IFS (more portable than tr)
    OLD_IFS="$IFS"
    IFS=","
    for mount_spec in $MOUNTS; do
        TAG="${mount_spec%%:*}"
        MPATH="${mount_spec##*:}"
        if [ -n "$TAG" ] && [ -n "$MPATH" ]; then
            mkdir -p "$MPATH"
            mount -t virtiofs "$TAG" "$MPATH" 2>/dev/null || true
        fi
    done
    IFS="$OLD_IFS"
fi
MOUNTEOF
        chmod +x /etc/profile.d/virtiofs-mount.sh

        # Create .profile for root
        # Checks VM_USER kernel arg - if set to 'agent', switches to agent user
        cat > /root/.profile << "PROFILEEOF"
# Parse kernel boot args (BusyBox compatible)
VM_USER=""
for arg in $(cat /proc/cmdline); do
    case "$arg" in
        VM_USER=*) VM_USER="${arg#VM_USER=}" ;;
    esac
done

# Switch to agent user if requested
if [ "$VM_USER" = "agent" ]; then
    exec su - agent
fi

# Source mount script
. /etc/profile.d/virtiofs-mount.sh

# Change to workspace if mounted
if mountpoint -q /root/workspace 2>/dev/null; then
    cd /root/workspace
fi

# Source VM startup script from workspace (allows changes without rootfs rebuild)
if [ -f ~/workspace/.opus-orchestra/vm-startup.sh ]; then
    . ~/workspace/.opus-orchestra/vm-startup.sh
fi
PROFILEEOF

        cat > /root/.bashrc << "BASHEOF"
if [ -f ~/.profile ]; then
    . ~/.profile
fi
BASHEOF
        mkdir -p /root/workspace

        # Create .claude.json to skip onboarding prompt
        cat > /root/.claude.json << "CLAUDEJSONEOF"
{"hasCompletedOnboarding": true, "numStartups": 1}
CLAUDEJSONEOF

        # Create .profile for agent user (used when VM_USER=agent)
        cat > /home/agent/.profile << "PROFILEEOF"
# Source mount script
. /etc/profile.d/virtiofs-mount.sh

# Change to workspace if mounted
if mountpoint -q /home/agent/workspace 2>/dev/null; then
    cd /home/agent/workspace
fi

# Source VM startup script from workspace (allows changes without rootfs rebuild)
if [ -f ~/workspace/.opus-orchestra/vm-startup.sh ]; then
    . ~/workspace/.opus-orchestra/vm-startup.sh
fi
PROFILEEOF
        chown agent:agent /home/agent/.profile

        cat > /home/agent/.bashrc << "BASHEOF"
if [ -f ~/.profile ]; then
    . ~/.profile
fi
BASHEOF
        chown agent:agent /home/agent/.bashrc
        mkdir -p /home/agent/workspace
        chown agent:agent /home/agent/workspace

        # Create .claude.json to skip onboarding prompt
        cat > /home/agent/.claude.json << "CLAUDEJSONEOF"
{"hasCompletedOnboarding": true, "numStartups": 1}
CLAUDEJSONEOF
        chown agent:agent /home/agent/.claude.json
    '

    # Cleanup
    require_sudo umount "$MOUNT_DIR"
    rmdir "$MOUNT_DIR"
    rm -f "$ALPINE_TAR"

    # Fix ownership so non-root user can use the rootfs
    if [[ -n "$SUDO_USER" ]]; then
        chown "$SUDO_USER:$SUDO_USER" "$ROOTFS_PATH"
    fi

    print_status "ok" "Root filesystem" "$ROOTFS_PATH"
    echo ""
    echo "Rootfs built with:"
    echo "  - Alpine Linux ${ALPINE_VERSION}"
    echo "  - Node.js and npm"
    echo "  - Claude Code (claude command)"
    echo "  - Auto-login as 'agent' user"
    echo "  - virtio-fs mount script"
    echo "  - Auto-start Claude with session ID from kernel boot args"
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

# Network configuration
CH_BRIDGE="chbr0"
CH_BRIDGE_IP="192.168.100.1"
CH_BRIDGE_SUBNET="192.168.100.0/24"

# Check if networking is set up
check_network() {
    local ok=true

    # Check bridge
    if ip link show "$CH_BRIDGE" &>/dev/null; then
        print_status "ok" "Network bridge" "$CH_BRIDGE exists"
    else
        print_status "warn" "Network bridge" "not configured (run: $0 network)"
        ok=false
    fi

    # Check CAP_NET_ADMIN on cloud-hypervisor
    if command_exists cloud-hypervisor; then
        local caps=$(getcap $(which cloud-hypervisor) 2>/dev/null)
        if echo "$caps" | grep -q "cap_net_admin"; then
            print_status "ok" "Network capability" "CAP_NET_ADMIN set on cloud-hypervisor"
        else
            print_status "warn" "Network capability" "CAP_NET_ADMIN not set (run: $0 network)"
            ok=false
        fi
    fi

    $ok
}

# Set up networking (bridge + NAT + capabilities)
setup_network() {
    print_section "Setting up Cloud Hypervisor networking..."

    echo "This will:"
    echo "  - Create bridge: $CH_BRIDGE ($CH_BRIDGE_IP/24)"
    echo "  - Set up NAT for internet access"
    echo "  - Grant CAP_NET_ADMIN to cloud-hypervisor (so it can create TAP devices)"
    echo ""

    # Check if bridge already exists
    if ip link show "$CH_BRIDGE" &>/dev/null; then
        echo "Bridge $CH_BRIDGE already exists, skipping bridge creation."
    else
        echo "Creating bridge $CH_BRIDGE..."
        require_sudo ip link add name "$CH_BRIDGE" type bridge
        require_sudo ip addr add "$CH_BRIDGE_IP/24" dev "$CH_BRIDGE"
        require_sudo ip link set "$CH_BRIDGE" up
    fi

    echo "Setting up NAT (masquerade)..."
    # Enable IP forwarding
    require_sudo sysctl -w net.ipv4.ip_forward=1 >/dev/null

    # Add masquerade rule if not already present
    if ! require_sudo iptables -t nat -C POSTROUTING -s "$CH_BRIDGE_SUBNET" ! -o "$CH_BRIDGE" -j MASQUERADE 2>/dev/null; then
        require_sudo iptables -t nat -A POSTROUTING -s "$CH_BRIDGE_SUBNET" ! -o "$CH_BRIDGE" -j MASQUERADE
    fi

    # Allow forwarding to/from the bridge
    if ! require_sudo iptables -C FORWARD -i "$CH_BRIDGE" -j ACCEPT 2>/dev/null; then
        require_sudo iptables -A FORWARD -i "$CH_BRIDGE" -j ACCEPT
    fi
    if ! require_sudo iptables -C FORWARD -o "$CH_BRIDGE" -j ACCEPT 2>/dev/null; then
        require_sudo iptables -A FORWARD -o "$CH_BRIDGE" -j ACCEPT
    fi

    # Grant CAP_NET_ADMIN to cloud-hypervisor so it can create TAP devices
    if command_exists cloud-hypervisor; then
        local ch_path=$(which cloud-hypervisor)
        echo "Granting CAP_NET_ADMIN to $ch_path..."
        require_sudo setcap cap_net_admin+ep "$ch_path"
        print_status "ok" "Capability" "CAP_NET_ADMIN granted to cloud-hypervisor"
    else
        print_status "warn" "Capability" "cloud-hypervisor not found, skipping capability setup"
    fi

    # Allow user to attach TAP devices to bridge without password
    echo "Creating sudoers rule for bridge operations..."
    require_sudo tee /etc/sudoers.d/cloud-hypervisor-network >/dev/null << SUDOEOF
# Allow Cloud Hypervisor users to manage TAP devices on the CH bridge
$REAL_USER ALL=(root) NOPASSWD: /usr/sbin/ip link set chtap* master $CH_BRIDGE
$REAL_USER ALL=(root) NOPASSWD: /usr/sbin/ip link set chtap* up
$REAL_USER ALL=(root) NOPASSWD: /usr/sbin/ip link set chtap* down
$REAL_USER ALL=(root) NOPASSWD: /usr/sbin/ip link del chtap*
SUDOEOF
    require_sudo chmod 440 /etc/sudoers.d/cloud-hypervisor-network
    print_status "ok" "Sudoers" "bridge operations allowed without password"

    # Make persistent
    setup_network_persistence

    print_status "ok" "Network" "configured"
    echo ""
    echo "VMs will use IP range: 192.168.100.2 - 192.168.100.254"
    echo "Gateway: $CH_BRIDGE_IP"
    echo "DNS: 8.8.8.8 (configurable)"
    echo ""
    echo "Cloud Hypervisor will create TAP devices automatically when VMs start."
}

# Clean up networking
cleanup_network() {
    echo "Cleaning up network configuration..."

    # Remove any TAP devices created by cloud-hypervisor
    for tap in $(ip link show | grep -oE "chtap[0-9]+" | sort -u); do
        require_sudo ip link del "$tap" 2>/dev/null || true
    done

    # Remove bridge
    if ip link show "$CH_BRIDGE" &>/dev/null; then
        require_sudo ip link set "$CH_BRIDGE" down 2>/dev/null || true
        require_sudo ip link del "$CH_BRIDGE" 2>/dev/null || true
    fi

    # Remove iptables rules
    require_sudo iptables -t nat -D POSTROUTING -s "$CH_BRIDGE_SUBNET" ! -o "$CH_BRIDGE" -j MASQUERADE 2>/dev/null || true
    require_sudo iptables -D FORWARD -i "$CH_BRIDGE" -j ACCEPT 2>/dev/null || true
    require_sudo iptables -D FORWARD -o "$CH_BRIDGE" -j ACCEPT 2>/dev/null || true

    # Remove capability from cloud-hypervisor
    if command_exists cloud-hypervisor; then
        require_sudo setcap -r "$(which cloud-hypervisor)" 2>/dev/null || true
    fi

    # Remove sudoers rule
    require_sudo rm -f /etc/sudoers.d/cloud-hypervisor-network

    # Remove persistence
    require_sudo rm -f /etc/systemd/system/cloud-hypervisor-network.service
    require_sudo systemctl daemon-reload 2>/dev/null || true

    print_status "ok" "Network" "cleaned up"
}

# Make network configuration persistent across reboots
setup_network_persistence() {
    echo "Creating systemd service for persistence..."

    require_sudo tee /etc/systemd/system/cloud-hypervisor-network.service >/dev/null << EOF
[Unit]
Description=Cloud Hypervisor Network Setup
After=network.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/bash -c '\\
    ip link add name $CH_BRIDGE type bridge 2>/dev/null || true; \\
    ip addr add $CH_BRIDGE_IP/24 dev $CH_BRIDGE 2>/dev/null || true; \\
    ip link set $CH_BRIDGE up; \\
    sysctl -w net.ipv4.ip_forward=1; \\
    iptables -t nat -C POSTROUTING -s $CH_BRIDGE_SUBNET ! -o $CH_BRIDGE -j MASQUERADE 2>/dev/null || \\
    iptables -t nat -A POSTROUTING -s $CH_BRIDGE_SUBNET ! -o $CH_BRIDGE -j MASQUERADE; \\
    iptables -C FORWARD -i $CH_BRIDGE -j ACCEPT 2>/dev/null || iptables -A FORWARD -i $CH_BRIDGE -j ACCEPT; \\
    iptables -C FORWARD -o $CH_BRIDGE -j ACCEPT 2>/dev/null || iptables -A FORWARD -o $CH_BRIDGE -j ACCEPT'
ExecStop=/bin/bash -c '\\
    iptables -t nat -D POSTROUTING -s $CH_BRIDGE_SUBNET ! -o $CH_BRIDGE -j MASQUERADE || true; \\
    iptables -D FORWARD -i $CH_BRIDGE -j ACCEPT || true; \\
    iptables -D FORWARD -o $CH_BRIDGE -j ACCEPT || true; \\
    ip link del $CH_BRIDGE || true'

[Install]
WantedBy=multi-user.target
EOF

    require_sudo systemctl daemon-reload
    require_sudo systemctl enable cloud-hypervisor-network.service

    print_status "ok" "Persistence" "systemd service enabled"
}

# Get the real user (not root when using sudo)
if [[ -n "$SUDO_USER" ]]; then
    REAL_USER="$SUDO_USER"
else
    REAL_USER="$USER"
fi

# Full setup
setup_cloud_hypervisor() {
    print_section "Setting up Cloud Hypervisor..."

    # Platform check - WSL2 supports KVM with nested virtualization
    if [[ "$OS" != "linux" && "$OS" != "wsl" ]]; then
        echo "Cloud Hypervisor only runs on Linux with KVM support."
        echo ""
        case "$OS" in
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

    # Download Cloud Hypervisor
    if ! check_cloud_hypervisor; then
        download_cloud_hypervisor
    fi

    # Install virtiofsd
    if ! check_virtiofsd; then
        install_virtiofsd
    fi

    # Download kernel
    if ! check_kernel; then
        download_kernel
    fi

    # Check rootfs
    if ! check_rootfs; then
        echo ""
        echo "To build the rootfs, run:"
        echo "  $0 rootfs"
    fi

    echo ""
    echo -e "${GREEN}Cloud Hypervisor setup complete!${NC}"
    echo ""
    echo "Configure VS Code settings:"
    echo "  claudeAgents.cloudHypervisorPath: /usr/local/bin/cloud-hypervisor"
    echo "  claudeAgents.isolationTier: cloud-hypervisor"
}

# Main
case "${1:-setup}" in
    check)
        check_kvm || true
        check_cloud_hypervisor || true
        check_virtiofsd || true
        check_kernel || true
        check_rootfs || true
        check_network || true
        ;;
    kernel)
        download_kernel
        ;;
    rootfs)
        build_rootfs
        ;;
    kvm)
        fix_kvm_permissions
        ;;
    virtiofsd)
        install_virtiofsd
        ;;
    network)
        setup_network "${2:-$CH_TAP_COUNT}"
        ;;
    network-cleanup)
        cleanup_network
        ;;
    setup|"")
        setup_cloud_hypervisor
        ;;
    *)
        echo "Usage: $0 [check|kernel|rootfs|kvm|virtiofsd|network|network-cleanup|setup]"
        echo ""
        echo "Commands:"
        echo "  check           - Check installation status"
        echo "  setup           - Full setup (binaries, kernel)"
        echo "  kernel          - Download kernel only"
        echo "  rootfs          - Build root filesystem"
        echo "  kvm             - Fix KVM permissions"
        echo "  virtiofsd       - Install virtiofsd"
        echo "  network [N]     - Set up networking with N TAP devices (default: 100)"
        echo "  network-cleanup - Remove network configuration"
        exit 1
        ;;
esac
