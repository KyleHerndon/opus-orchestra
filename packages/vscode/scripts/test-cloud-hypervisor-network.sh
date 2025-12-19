#!/bin/bash
# Integration test for Cloud Hypervisor with TAP networking
# Tests: VM boot, network config, internet connectivity
set -e

RUNTIME_DIR="/tmp/cloud-hypervisor-net-test-$$"
VIRTIOFSD="/usr/libexec/virtiofsd"
SHARED_DIR="/tmp/ch-net-test-shared-$$"
TMUX_SESSION="ch-net-test-$$"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

cleanup() {
    echo ""
    echo "Cleaning up..."
    pkill -f "cloud-hypervisor.*${RUNTIME_DIR}" 2>/dev/null || true
    pkill -f "virtiofsd.*${RUNTIME_DIR}" 2>/dev/null || true
    tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
    rm -rf "$RUNTIME_DIR" "$SHARED_DIR"
}
trap cleanup EXIT

pass() { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; [[ -n "$2" ]] && echo "    $2"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
info() { echo -e "  $1"; }

echo "=== Cloud Hypervisor Network Integration Test ==="
echo ""

# Find virtiofsd
for loc in /usr/libexec/virtiofsd /usr/lib/qemu/virtiofsd; do
    [[ -x "$loc" ]] && VIRTIOFSD="$loc" && break
done

# 1. Check prerequisites
echo "1. Checking prerequisites..."
[[ -w /dev/kvm ]] || { fail "KVM not accessible"; exit 1; }
which cloud-hypervisor >/dev/null || { fail "cloud-hypervisor not found"; exit 1; }
[[ -f ~/.opus-orchestra/cloud-hypervisor/vmlinux ]] || { fail "Kernel not found"; exit 1; }
[[ -f ~/.opus-orchestra/cloud-hypervisor/rootfs.ext4 ]] || { fail "Rootfs not found"; exit 1; }
[[ -x "$VIRTIOFSD" ]] || { fail "virtiofsd not found"; exit 1; }
pass "Basic prerequisites OK"

# 2. Check network setup
echo ""
echo "2. Checking network setup..."
if ip link show chbr0 &>/dev/null; then
    BRIDGE_IP=$(ip addr show chbr0 | grep -oP 'inet \K[0-9.]+')
    pass "Bridge chbr0 exists (IP: $BRIDGE_IP)"
else
    fail "Bridge chbr0 not found"
    echo "    Run: sudo ./scripts/setup/cloud-hypervisor.sh network"
    exit 1
fi

# Check cloud-hypervisor has CAP_NET_ADMIN
CH_CAPS=$(getcap $(which cloud-hypervisor) 2>/dev/null)
if echo "$CH_CAPS" | grep -q "cap_net_admin"; then
    pass "cloud-hypervisor has CAP_NET_ADMIN"
else
    fail "cloud-hypervisor missing CAP_NET_ADMIN"
    echo "    Run: sudo ./scripts/setup/cloud-hypervisor.sh network"
    exit 1
fi

# Find available TAP index (not in use)
TAP_INDEX=0
for i in $(seq 0 99); do
    if ! ip link show "chtap$i" &>/dev/null; then
        TAP_INDEX=$i
        break
    fi
done
TAP_DEVICE="chtap$TAP_INDEX"

# Calculate VM IP
VM_IP="192.168.100.$((2 + TAP_INDEX))"
VM_GATEWAY="192.168.100.1"
info "Will create TAP device: $TAP_DEVICE"
info "VM will use IP: $VM_IP, Gateway: $VM_GATEWAY"

# 3. Setup
echo ""
echo "3. Setting up test environment..."
mkdir -p "$RUNTIME_DIR" "$SHARED_DIR"
echo "network-test-$(date +%s)" > "$SHARED_DIR/sentinel.txt"
pass "Created runtime directories"

# 4. Start virtiofsd
echo ""
echo "4. Starting virtiofsd..."
$VIRTIOFSD \
    --socket-path="$RUNTIME_DIR/virtiofsd.socket" \
    --shared-dir="$SHARED_DIR" \
    --sandbox=none \
    > "$RUNTIME_DIR/virtiofsd.log" 2>&1 &
VIRTIOFSD_PID=$!

for i in {1..50}; do [[ -S "$RUNTIME_DIR/virtiofsd.socket" ]] && break; sleep 0.1; done
[[ -S "$RUNTIME_DIR/virtiofsd.socket" ]] || { fail "virtiofsd socket not created" "$(cat "$RUNTIME_DIR/virtiofsd.log")"; exit 1; }
sleep 0.5
kill -0 $VIRTIOFSD_PID 2>/dev/null || { fail "virtiofsd crashed" "$(cat "$RUNTIME_DIR/virtiofsd.log")"; exit 1; }
pass "virtiofsd running (PID $VIRTIOFSD_PID)"

# 5. Start Cloud Hypervisor with networking
echo ""
echo "5. Starting Cloud Hypervisor with TAP networking..."

# Build kernel cmdline with network config
CMDLINE="console=ttyS0 root=/dev/vda rw VM_IP=$VM_IP VM_GATEWAY=$VM_GATEWAY VM_DNS=8.8.8.8 VIRTIOFS_MOUNTS=shared:/mnt/shared"

cat > "$RUNTIME_DIR/start.sh" << EOF
#!/bin/bash
exec cloud-hypervisor \\
    --api-socket "$RUNTIME_DIR/api.socket" \\
    --kernel ~/.opus-orchestra/cloud-hypervisor/vmlinux \\
    --cmdline "$CMDLINE" \\
    --cpus boot=2 \\
    --memory size=2048M,shared=on \\
    --disk path=~/.opus-orchestra/cloud-hypervisor/rootfs.ext4 \\
    --serial tty \\
    --console off \\
    --net tap=$TAP_DEVICE \\
    --fs tag=shared,socket=$RUNTIME_DIR/virtiofsd.socket,num_queues=1,queue_size=512
EOF
chmod +x "$RUNTIME_DIR/start.sh"

info "Command: cloud-hypervisor --net tap=$TAP_DEVICE ..."
info "Kernel args: $CMDLINE"

tmux new-session -d -s "$TMUX_SESSION" "$RUNTIME_DIR/start.sh"

for i in {1..100}; do [[ -S "$RUNTIME_DIR/api.socket" ]] && break; sleep 0.1; done
if [[ ! -S "$RUNTIME_DIR/api.socket" ]]; then
    fail "CH API socket not created"
    echo "    tmux output:"
    tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null | tail -20
    exit 1
fi
sleep 1
tmux has-session -t "$TMUX_SESSION" 2>/dev/null || { fail "Cloud Hypervisor crashed"; exit 1; }
pass "Cloud Hypervisor running"

# Attach TAP to bridge
echo ""
echo "5b. Attaching TAP to bridge..."
for i in {1..50}; do
    if ip link show "$TAP_DEVICE" &>/dev/null; then
        break
    fi
    sleep 0.1
done

if ip link show "$TAP_DEVICE" &>/dev/null; then
    sudo /usr/sbin/ip link set "$TAP_DEVICE" master chbr0 2>/dev/null || warn "Could not add to bridge"
    sudo /usr/sbin/ip link set "$TAP_DEVICE" up 2>/dev/null || true
    pass "TAP $TAP_DEVICE attached to bridge"
else
    fail "TAP device $TAP_DEVICE not created by Cloud Hypervisor"
fi

# 6. Wait for VM to boot
echo ""
echo "6. Waiting for VM to boot (up to 30s)..."
BOOTED=false
for i in {1..30}; do
    OUTPUT=$(tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null)
    if echo "$OUTPUT" | grep -qE '(cloud-hypervisor.*[#$]|localhost.*[#$]|:~[#$])'; then
        pass "VM booted"
        BOOTED=true
        break
    fi
    sleep 1
    echo -ne "\r   Waiting... ${i}s"
done
echo ""

if [[ "$BOOTED" != "true" ]]; then
    fail "VM did not boot in time"
    echo "    Last output:"
    tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null | tail -30
    exit 1
fi

# 7. Check network interface
echo ""
echo "7. Checking network interface inside VM..."
tmux send-keys -t "$TMUX_SESSION" "ip addr show eth0 2>&1; echo ETH0_CHECK_DONE" Enter
sleep 3

OUTPUT=$(tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null)
if echo "$OUTPUT" | grep -q "ETH0_CHECK_DONE"; then
    if echo "$OUTPUT" | grep -q "$VM_IP"; then
        pass "eth0 has correct IP: $VM_IP"
    elif echo "$OUTPUT" | grep -q "inet "; then
        ACTUAL_IP=$(echo "$OUTPUT" | grep -oP 'inet \K[0-9.]+' | head -1)
        warn "eth0 has different IP: $ACTUAL_IP (expected $VM_IP)"
    elif echo "$OUTPUT" | grep -q "does not exist"; then
        fail "eth0 does not exist"
        echo "    Output:"
        echo "$OUTPUT" | grep -A5 "ip addr"
    else
        fail "eth0 has no IP address"
        echo "    Output:"
        echo "$OUTPUT" | grep -A10 "ip addr"
    fi
else
    fail "Command did not complete"
    echo "    Output:"
    echo "$OUTPUT" | tail -20
fi

# 8. Check routing
echo ""
echo "8. Checking routing..."
tmux send-keys -t "$TMUX_SESSION" "ip route; echo ROUTE_CHECK_DONE" Enter
sleep 2

OUTPUT=$(tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null)
if echo "$OUTPUT" | grep -q "ROUTE_CHECK_DONE"; then
    if echo "$OUTPUT" | grep -q "default via $VM_GATEWAY"; then
        pass "Default route via $VM_GATEWAY"
    elif echo "$OUTPUT" | grep -q "default via"; then
        ACTUAL_GW=$(echo "$OUTPUT" | grep -oP 'default via \K[0-9.]+')
        warn "Default route via $ACTUAL_GW (expected $VM_GATEWAY)"
    else
        fail "No default route"
        echo "    Routes:"
        echo "$OUTPUT" | grep -E "^(default|[0-9])" | head -5
    fi
fi

# 9. Check DNS
echo ""
echo "9. Checking DNS configuration..."
tmux send-keys -t "$TMUX_SESSION" "cat /etc/resolv.conf; echo DNS_CHECK_DONE" Enter
sleep 2

OUTPUT=$(tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null)
if echo "$OUTPUT" | grep -q "DNS_CHECK_DONE"; then
    if echo "$OUTPUT" | grep -q "nameserver"; then
        DNS=$(echo "$OUTPUT" | grep -oP 'nameserver \K[0-9.]+' | head -1)
        pass "DNS configured: $DNS"
    else
        fail "No DNS configured"
    fi
fi

# 10. Ping gateway
echo ""
echo "10. Testing connectivity to gateway..."
tmux send-keys -t "$TMUX_SESSION" "ping -c 2 -W 3 $VM_GATEWAY && echo PING_GW_OK || echo PING_GW_FAIL" Enter
sleep 5

OUTPUT=$(tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null)
if echo "$OUTPUT" | grep -q "PING_GW_OK"; then
    pass "Can ping gateway ($VM_GATEWAY)"
elif echo "$OUTPUT" | grep -q "PING_GW_FAIL"; then
    fail "Cannot ping gateway"
    echo "    This suggests TAP/bridge connectivity issue"
else
    warn "Ping command did not complete"
fi

# 11. Ping external (8.8.8.8)
echo ""
echo "11. Testing internet connectivity (ping 8.8.8.8)..."
tmux send-keys -t "$TMUX_SESSION" "ping -c 2 -W 5 8.8.8.8 && echo PING_EXT_OK || echo PING_EXT_FAIL" Enter
sleep 8

OUTPUT=$(tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null)
if echo "$OUTPUT" | grep -q "PING_EXT_OK"; then
    pass "Can ping 8.8.8.8 (internet works!)"
elif echo "$OUTPUT" | grep -q "PING_EXT_FAIL"; then
    fail "Cannot ping 8.8.8.8"
    echo "    This suggests NAT/masquerade issue"
    echo "    Check: sudo iptables -t nat -L POSTROUTING"
else
    warn "Ping command did not complete"
fi

# 12. Test DNS resolution
echo ""
echo "12. Testing DNS resolution..."
tmux send-keys -t "$TMUX_SESSION" "nslookup google.com 8.8.8.8 2>&1 | head -10; echo DNS_RESOLVE_DONE" Enter
sleep 5

OUTPUT=$(tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null)
if echo "$OUTPUT" | grep -q "DNS_RESOLVE_DONE"; then
    if echo "$OUTPUT" | grep -qE "Address.*[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"; then
        pass "DNS resolution works"
    else
        warn "DNS resolution may have issues"
        echo "    Output:"
        echo "$OUTPUT" | grep -A5 "nslookup"
    fi
fi

# 13. Test HTTPS (curl)
echo ""
echo "13. Testing HTTPS connectivity..."
tmux send-keys -t "$TMUX_SESSION" "curl -s --connect-timeout 10 -o /dev/null -w '%{http_code}' https://api.anthropic.com/v1/messages 2>&1; echo CURL_DONE" Enter
sleep 12

OUTPUT=$(tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null)
if echo "$OUTPUT" | grep -q "CURL_DONE"; then
    # Look for HTTP status code (401 is expected without auth, but means connection worked)
    if echo "$OUTPUT" | grep -qE "(200|401|403|404)"; then
        HTTP_CODE=$(echo "$OUTPUT" | grep -oE "(200|401|403|404)" | tail -1)
        pass "HTTPS works (HTTP $HTTP_CODE from api.anthropic.com)"
    elif echo "$OUTPUT" | grep -q "000"; then
        fail "HTTPS connection failed (HTTP 000)"
    else
        warn "Unexpected curl result"
        echo "    Output:"
        echo "$OUTPUT" | tail -5
    fi
else
    warn "curl command did not complete in time"
fi

# Summary
echo ""
echo "=== Test Summary ==="
echo ""
echo "To attach to VM console: tmux attach -t $TMUX_SESSION"
echo "To see full boot log: tmux capture-pane -t $TMUX_SESSION -p"
echo ""
echo "Debug commands inside VM:"
echo "  ip addr show eth0     # Check IP"
echo "  ip route              # Check routes"
echo "  cat /etc/resolv.conf  # Check DNS"
echo "  ping 192.168.100.1    # Ping gateway"
echo "  ping 8.8.8.8          # Ping internet"
echo "  curl https://google.com  # Test HTTPS"
echo ""
echo "Press Enter to cleanup and exit, or Ctrl+C to keep VM running..."
read
