# Opus Orchestra Setup Scripts

Scripts for setting up various isolation features for Opus Orchestra agents.

## Quick Start

### Linux/macOS/WSL

```bash
# Check what's available
./setup.sh check

# Interactive mode
./setup.sh

# Set up specific features
./setup.sh docker      # Docker isolation
./setup.sh gvisor      # gVisor (enhanced Docker)
./setup.sh firecracker # Firecracker VMs (Linux only)
./setup.sh sandbox     # Lightweight sandbox

# Set up everything
./setup.sh all
```

### Windows (PowerShell)

```powershell
# Check what's available
.\setup.ps1 check

# Interactive mode
.\setup.ps1

# Set up Docker
.\setup.ps1 docker
```

## Directory Structure

```
scripts/
├── setup.sh           # Main entry point (Linux/macOS/WSL)
├── setup.ps1          # Windows PowerShell version
├── README.md          # This file
└── setup/             # Individual setup modules
    ├── common.sh      # Shared utilities and functions
    ├── docker.sh      # Docker setup
    ├── gvisor.sh      # gVisor setup
    ├── firecracker.sh # Firecracker setup
    └── sandbox.sh     # Sandbox runtime setup
```

## Individual Scripts

Each setup module can be run independently:

```bash
# Docker
./setup/docker.sh check   # Check Docker status
./setup/docker.sh build   # Build sandbox image only
./setup/docker.sh setup   # Full Docker setup

# gVisor
./setup/gvisor.sh check   # Check gVisor status
./setup/gvisor.sh setup   # Install and configure gVisor

# Firecracker
./setup/firecracker.sh check   # Check Firecracker status
./setup/firecracker.sh kernel  # Download kernel only
./setup/firecracker.sh kvm     # Fix KVM permissions
./setup/firecracker.sh setup   # Full Firecracker setup

# Sandbox
./setup/sandbox.sh check  # Check sandbox runtime
./setup/sandbox.sh test   # Test bubblewrap (Linux)
./setup/sandbox.sh setup  # Install sandbox runtime
```

## Isolation Tiers

| Tier | Platform | Isolation | Performance | Use Case |
|------|----------|-----------|-------------|----------|
| Standard | All | None (manual approval) | Best | Development, trusted tasks |
| Sandbox | Linux/macOS | Good | Very Low | Single developer, CI/CD |
| Docker | All* | Good | Low | Most production use |
| gVisor | Linux | Excellent | Medium | Multi-tenant, untrusted content |
| Firecracker | Linux | Excellent | High startup | Maximum isolation |

*Docker on Windows/macOS runs in a Linux VM

## Requirements by Tier

### Docker
- Docker Desktop (Windows/macOS) or Docker Engine (Linux)
- WSL 2 backend recommended on Windows

### gVisor
- Linux only (native, not WSL)
- Docker with runsc runtime configured
- Requires `curl`, `python3` for installation

### Firecracker
- Linux only with KVM support
- `/dev/kvm` accessible (user must be in `kvm` group)
- Kernel and rootfs images

### Sandbox Runtime
- Linux: `bubblewrap` (bwrap) package
- macOS: `sandbox-exec` (built-in)

## After Setup

1. Open VS Code Settings (Ctrl+,)
2. Search for "Claude Agents"
3. Set `claudeAgents.isolationTier` to your preferred tier
4. Create new agents - they'll use the selected isolation

Or use the command palette:
- `Claude Agents: Check Isolation Tiers` - View and change isolation tier
- `Claude Agents: Run Setup Script` - Run setup from VS Code

## Troubleshooting

### Docker not running
```bash
# Linux
sudo systemctl start docker

# WSL (using Docker Desktop)
# Start Docker Desktop from Windows

# WSL (Docker in WSL)
sudo service docker start
```

### Permission denied on /dev/kvm
```bash
# Add user to kvm group
sudo usermod -aG kvm $USER

# Log out and back in for changes to take effect
```

### gVisor not detected
```bash
# Verify runsc is in Docker runtimes
docker info --format '{{json .Runtimes}}'
# Should show "runsc" in the output

# If not, check daemon.json
cat /etc/docker/daemon.json
```

### Bubblewrap not working
```bash
# Test bubblewrap
./setup/sandbox.sh test

# Check if user namespaces are enabled
cat /proc/sys/kernel/unprivileged_userns_clone
# Should be 1
```

## Environment Variables

Some scripts support environment variables:

```bash
# Firecracker version
FC_VERSION=v1.5.0 ./setup/firecracker.sh setup

# Firecracker data directory
FC_DATA_DIR=/opt/firecracker ./setup/firecracker.sh setup
```
