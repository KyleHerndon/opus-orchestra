#!/bin/bash
# Integration test for Cloud Hypervisor + virtio-fs
# Verifies the VM can read/write files through virtio-fs mount
set -e

RUNTIME_DIR="/tmp/cloud-hypervisor-test-$$"
VIRTIOFSD="/usr/libexec/virtiofsd"
SHARED_DIR="/tmp/ch-test-shared-$$"
TMUX_SESSION="ch-test-$$"

RED='\033[0;31m'
GREEN='\033[0;32m'
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
fail() { echo -e "  ${RED}✗${NC} $1"; [[ -n "$2" ]] && echo "    $2"; exit 1; }

echo "=== Cloud Hypervisor + virtio-fs Integration Test ==="
echo ""

# Find virtiofsd
for loc in /usr/libexec/virtiofsd /usr/lib/qemu/virtiofsd; do
    [[ -x "$loc" ]] && VIRTIOFSD="$loc" && break
done
[[ -x "$VIRTIOFSD" ]] || fail "virtiofsd not found"

# Check prerequisites
echo "1. Prerequisites..."
[[ -w /dev/kvm ]] || fail "KVM not accessible"
which cloud-hypervisor >/dev/null || fail "cloud-hypervisor not found"
[[ -f ~/.opus-orchestra/cloud-hypervisor/vmlinux ]] || fail "Kernel not found"
[[ -f ~/.opus-orchestra/cloud-hypervisor/rootfs.ext4 ]] || fail "Rootfs not found"
pass "All prerequisites OK"

# Setup
echo ""
echo "2. Setup..."
mkdir -p "$RUNTIME_DIR" "$SHARED_DIR"

# Create sentinel file on host
SENTINEL_VALUE="host-$(date +%s)-$$"
echo "$SENTINEL_VALUE" > "$SHARED_DIR/from-host.txt"
pass "Created host sentinel: $SENTINEL_VALUE"

# Start virtiofsd
echo ""
echo "3. Starting virtiofsd..."
$VIRTIOFSD \
    --socket-path="$RUNTIME_DIR/virtiofsd.socket" \
    --shared-dir="$SHARED_DIR" \
    --sandbox=none \
    > "$RUNTIME_DIR/virtiofsd.log" 2>&1 &
VIRTIOFSD_PID=$!

for i in {1..50}; do [[ -S "$RUNTIME_DIR/virtiofsd.socket" ]] && break; sleep 0.1; done
[[ -S "$RUNTIME_DIR/virtiofsd.socket" ]] || fail "virtiofsd socket not created" "$(cat "$RUNTIME_DIR/virtiofsd.log")"
sleep 0.5
kill -0 $VIRTIOFSD_PID 2>/dev/null || fail "virtiofsd crashed" "$(cat "$RUNTIME_DIR/virtiofsd.log")"
pass "virtiofsd running (PID $VIRTIOFSD_PID)"

# Start Cloud Hypervisor
echo ""
echo "4. Starting Cloud Hypervisor..."
cat > "$RUNTIME_DIR/start.sh" << EOF
#!/bin/bash
exec cloud-hypervisor \
    --api-socket "$RUNTIME_DIR/api.socket" \
    --kernel ~/.opus-orchestra/cloud-hypervisor/vmlinux \
    --cmdline "console=ttyS0 root=/dev/vda rw" \
    --cpus boot=2 \
    --memory size=2048M,shared=on \
    --disk path=~/.opus-orchestra/cloud-hypervisor/rootfs.ext4 \
    --serial tty \
    --console off \
    --fs tag=shared,socket=$RUNTIME_DIR/virtiofsd.socket,num_queues=1,queue_size=512
EOF
chmod +x "$RUNTIME_DIR/start.sh"

tmux new-session -d -s "$TMUX_SESSION" "$RUNTIME_DIR/start.sh"

for i in {1..100}; do [[ -S "$RUNTIME_DIR/api.socket" ]] && break; sleep 0.1; done
[[ -S "$RUNTIME_DIR/api.socket" ]] || fail "CH API socket not created"
sleep 1
tmux has-session -t "$TMUX_SESSION" 2>/dev/null || fail "Cloud Hypervisor crashed"
pass "Cloud Hypervisor running"

# Wait for VM to boot - look for shell prompt (auto-login)
echo ""
echo "5. Waiting for VM to boot (up to 30s)..."
for i in {1..30}; do
    OUTPUT=$(tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null)
    # Look for shell prompt (cloud-hypervisor:~$) or login prompt
    if echo "$OUTPUT" | grep -qE '(cloud-hypervisor.*\$|login:)'; then
        pass "VM booted"
        break
    fi
    sleep 1
    echo -ne "\r   Waiting... ${i}s"
done
echo ""

OUTPUT=$(tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null)
echo "$OUTPUT" | grep -qE '(cloud-hypervisor.*\$|login:)' || fail "VM did not boot in time"

# Mount virtio-fs (running as root by default, no sudo needed)
echo ""
echo "6. Mounting virtio-fs..."
tmux send-keys -t "$TMUX_SESSION" "mkdir -p /mnt/shared && mount -t virtiofs shared /mnt/shared; mountpoint -q /mnt/shared && echo MOUNTED_SUCCESS_$$ || echo MOUNT_FAILED_$$" Enter
sleep 3

OUTPUT=$(tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null)
# Use ^ anchor to match only output lines, not the typed command
if echo "$OUTPUT" | grep -q "^MOUNTED_SUCCESS_$$"; then
    pass "virtio-fs mounted"
elif echo "$OUTPUT" | grep -q "^MOUNT_FAILED_$$"; then
    fail "Mount failed"
elif echo "$OUTPUT" | grep -q "Permission denied"; then
    fail "Permission denied - VM not running as root" "Rebuild rootfs: ./scripts/setup/cloud-hypervisor.sh rootfs"
else
    fail "Unexpected mount result" "$(echo "$OUTPUT" | tail -15)"
fi

# Test read from host
echo ""
echo "7. Testing host → VM read..."
tmux send-keys -t "$TMUX_SESSION" "cat /mnt/shared/from-host.txt && echo READ_DONE" Enter
sleep 2

OUTPUT=$(tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null)
if echo "$OUTPUT" | grep -q "$SENTINEL_VALUE"; then
    pass "VM can read host file"
elif echo "$OUTPUT" | grep -q "READ_DONE"; then
    # Command ran but sentinel not found - show what was captured
    echo "    DEBUG: Command ran but sentinel not in output"
    echo "    Expected: $SENTINEL_VALUE"
    echo "    Last 10 lines of capture:"
    echo "$OUTPUT" | tail -10
    fail "Sentinel not in output"
else
    echo "    DEBUG: Command may not have completed"
    echo "    Last 20 lines:"
    echo "$OUTPUT" | tail -20
    fail "VM cannot read host file"
fi

# Test write from VM
echo ""
echo "8. Testing VM → host write..."
VM_SENTINEL="vm-$(date +%s)-$$"
tmux send-keys -t "$TMUX_SESSION" "echo $VM_SENTINEL > /mnt/shared/from-vm.txt && echo WRITE_OK" Enter
sleep 2

OUTPUT=$(tmux capture-pane -t "$TMUX_SESSION" -p 2>/dev/null)
echo "$OUTPUT" | grep -q "WRITE_OK" || fail "Write command failed"

# Verify on host
if [[ -f "$SHARED_DIR/from-vm.txt" ]]; then
    HOST_READ=$(cat "$SHARED_DIR/from-vm.txt")
    if [[ "$HOST_READ" == "$VM_SENTINEL" ]]; then
        pass "Host can read VM-written file"
    else
        fail "Content mismatch" "Expected: $VM_SENTINEL, Got: $HOST_READ"
    fi
else
    fail "VM-written file not visible on host"
fi

echo ""
echo -e "${GREEN}=== ALL TESTS PASSED ===${NC}"
echo ""
echo "virtio-fs bidirectional I/O verified:"
echo "  Host → VM: ✓"
echo "  VM → Host: ✓"
