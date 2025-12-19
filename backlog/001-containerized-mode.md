# Sandboxed Agent Mode

## Summary

Run agents in isolated environments with `--dangerously-skip-permissions` for autonomous operation. Multiple isolation tiers available based on security requirements: sandbox runtime, Docker containers, gVisor, and Cloud Hypervisor VMs.

## Motivation

Currently, agents require manual approval for every file write, bash command, etc. This creates a high-friction workflow where the user is constantly context-switching to approve routine operations.

Sandboxed mode allows agents to run autonomously within isolated environments. The stronger the isolation, the more permissive we can be. Users review the final diff rather than individual operations.

**Key principle**: The more isolated the agent, the more autonomy it can safely have.

## Isolation Tiers

Based on [Anthropic's secure deployment guide](https://platform.claude.com/docs/en/agent-sdk/secure-deployment):

| Tier | Technology | Isolation Strength | Performance | Complexity | Use Case |
|------|------------|-------------------|-------------|------------|----------|
| 0 | Standard | None (manual approval) | Best | Lowest | Development, trusted tasks |
| 1 | Sandbox Runtime | Good | Very Low | Low | Single developer, CI/CD |
| 2 | Docker | Good (setup dependent) | Low | Medium | Most production use |
| 3 | gVisor | Excellent | Medium-High | Medium | Multi-tenant, untrusted content |
| 4 | Cloud Hypervisor VM | Excellent | High | High | Maximum isolation requirements |

### Tier 0: Standard Mode (No Isolation)

Default mode - agent runs in VS Code terminal with manual approval for all operations.

- Full host access
- Every operation requires approval
- No isolation overhead
- Best for: trusted tasks, development, learning

### Tier 1: Sandbox Runtime

Lightweight isolation using OS primitives without containers.

Uses [sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime):
- `bubblewrap` on Linux
- `sandbox-exec` on macOS
- Built-in network proxy for domain allowlists
- JSON-based configuration

**Advantages**:
- No Docker required
- Minimal setup
- Very low overhead
- Built-in proxy for network control

**Limitations**:
- Shares host kernel (kernel vulnerabilities could enable escape)
- No TLS inspection (proxy allowlists domains but can't inspect encrypted traffic)

**Configuration** (`.opus-orchestra/sandbox.json`):
```json
{
  "tier": "sandbox",
  "allowedPaths": [
    { "path": "/workspace", "writable": true },
    { "path": "/tmp", "writable": true }
  ],
  "allowedDomains": [
    "api.anthropic.com",
    "registry.npmjs.org",
    "pypi.org"
  ]
}
```

### Tier 2: Docker Containers

Standard container isolation via Linux namespaces.

**Hardened Docker Configuration**:
```bash
docker run \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --security-opt seccomp=/path/to/seccomp-profile.json \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=100m \
  --tmpfs /home/agent:rw,noexec,nosuid,size=500m \
  --network none \
  --memory 2g \
  --cpus 2 \
  --pids-limit 100 \
  --user 1000:1000 \
  -v /path/to/worktree:/workspace:rw \
  -v /var/run/proxy.sock:/var/run/proxy.sock:ro \
  opus-orchestra-sandbox
```

| Option | Purpose |
|--------|---------|
| `--cap-drop ALL` | Remove Linux capabilities (NET_ADMIN, SYS_ADMIN, etc.) |
| `--security-opt no-new-privileges` | Prevent privilege escalation via setuid |
| `--security-opt seccomp=...` | Restrict available syscalls |
| `--read-only` | Immutable root filesystem |
| `--tmpfs /tmp:...` | Ephemeral writable directories |
| `--network none` | No network interfaces - use Unix socket proxy |
| `--memory 2g` | Prevent resource exhaustion |
| `--pids-limit 100` | Prevent fork bombs |
| `--user 1000:1000` | Non-root user |

**Network via Unix Socket**:
With `--network none`, agent has no network interfaces. All traffic goes through a mounted Unix socket to a proxy on the host that enforces domain allowlists and injects credentials.

### Tier 3: gVisor

Kernel-level isolation - intercepts syscalls in userspace before they reach host kernel.

```bash
# Install gVisor runtime
# Configure Docker daemon:
# /etc/docker/daemon.json
{
  "runtimes": {
    "runsc": {
      "path": "/usr/local/bin/runsc"
    }
  }
}

# Run with gVisor
docker run --runtime=runsc opus-orchestra-sandbox
```

**Performance Overhead**:
| Workload | Overhead |
|----------|----------|
| CPU-bound | ~0% |
| Simple syscalls | ~2× slower |
| Heavy file I/O | 10-200× slower |

**Best for**: Multi-tenant environments, processing untrusted content where kernel isolation is worth the overhead.

### Tier 4: Cloud Hypervisor VMs

Hardware-level isolation via CPU virtualization. Each agent runs in its own VM with its own kernel. Uses virtio-fs for fast file mounting from host to guest.

**Characteristics**:
- Boot time: <125ms
- Memory overhead: <5 MiB
- Full kernel isolation
- Communication via vsock (virtual sockets)
- virtio-fs for live file access (no copying)

**Architecture**:
```
┌─────────────────────────────────────────────────────────┐
│ Host                                                    │
│ ┌─────────────────┐  ┌─────────────────────────────┐   │
│ │ Proxy Service   │  │ Cloud Hypervisor VM         │   │
│ │ - Domain allow  │◄─┤ - Agent + Claude            │   │
│ │ - Cred inject   │  │ - vsock connection          │   │
│ │ - Logging       │  │ - Isolated kernel           │   │
│ └─────────────────┘  └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Best for**: Maximum security requirements, untrusted workloads, compliance-sensitive environments.

## Design

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│ VS Code Extension (Host)                                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐                                        │
│  │ Proxy       │ ← Runs on host, outside sandbox        │
│  │ - Allowlist │ ← Agents connect via socket/vsock      │
│  │ - Cred inj  │                                        │
│  └──────┬──────┘                                        │
│         │                                               │
│  ┌──────┴──────────────────────────────────────────┐   │
│  │ Agent (in sandbox/container/VM)                 │   │
│  │ ├─ Worktree (mounted rw)                        │   │
│  │ ├─ No direct network                            │   │
│  │ ├─ No host credentials                          │   │
│  │ └─ --dangerously-skip-permissions               │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Proxy Architecture

All isolated agents communicate through a proxy running on the host:

**Proxy Responsibilities**:
1. **Domain allowlist**: Only permit requests to configured domains
2. **Credential injection**: Add API keys, tokens to outgoing requests
3. **Request logging**: Audit all traffic for review
4. **TLS termination** (optional): Inspect HTTPS traffic

**Why proxy pattern**:
- Agent never sees actual credentials
- Exfiltration blocked at network level
- Single point for security policy enforcement
- Works with all isolation tiers

**Implementation Options**:
- Custom proxy (recommended for Opus Orchestra)
- [Envoy](https://www.envoyproxy.io/) with `credential_injector` filter
- [mitmproxy](https://mitmproxy.org/) for TLS inspection
- [LiteLLM](https://github.com/BerriAI/litellm) for LLM-specific proxying

### Settings

```json
{
  "claudeAgents.isolationTier": {
    "type": "string",
    "enum": ["standard", "sandbox", "docker", "gvisor", "cloud-hypervisor"],
    "default": "standard",
    "description": "Isolation tier for new agents"
  },
  "claudeAgents.proxyPort": {
    "type": "number",
    "default": 8377,
    "description": "Port for the isolation proxy"
  },
  "claudeAgents.allowedDomains": {
    "type": "array",
    "default": ["api.anthropic.com"],
    "description": "Domains agents can access (applies to all isolated tiers)"
  },
  "claudeAgents.containerImage": {
    "type": "string",
    "default": "ghcr.io/kyleherndon/opus-orchestra-sandbox:latest",
    "description": "Docker image for containerized agents"
  },
  "claudeAgents.containerMemoryLimit": {
    "type": "string",
    "default": "4g",
    "description": "Memory limit for containers/VMs"
  },
  "claudeAgents.containerCpuLimit": {
    "type": "string",
    "default": "2",
    "description": "CPU limit for containers/VMs"
  },
  "claudeAgents.gvisorEnabled": {
    "type": "boolean",
    "default": false,
    "description": "Use gVisor runtime for Docker containers"
  },
  "claudeAgents.cloudHypervisorPath": {
    "type": "string",
    "default": "",
    "description": "Path to Cloud Hypervisor binary (empty = not available)"
  }
}
```

### Settings UI

```
┌─────────────────────────────────────────────────────────┐
│ Agent Isolation                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Default Isolation Tier:                                 │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ○ Standard (manual approval, no isolation)          │ │
│ │                                                     │ │
│ │ ○ Sandbox Runtime (lightweight, good isolation)     │ │
│ │   Uses OS primitives, no Docker required            │ │
│ │                                                     │ │
│ │ ● Docker Container (recommended)                    │ │
│ │   Good isolation, moderate overhead                 │ │
│ │                                                     │ │
│ │ ○ gVisor (excellent isolation)                      │ │
│ │   Kernel-level isolation, higher overhead           │ │
│ │                                                     │ │
│ │ ○ Cloud Hypervisor VM (maximum isolation)           │ │
│ │   Full VM isolation, highest overhead               │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ ─────────────────────────────────────────────────────── │
│                                                         │
│ Network Allowlist:                                      │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ [api.anthropic.com] [×]                             │ │
│ │ [registry.npmjs.org] [×]                            │ │
│ │ [pypi.org] [×]                                      │ │
│ │ [+ Add Domain]                                      │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Resource Limits:                                        │
│ Memory: [4g_____]  CPU: [2__]  PIDs: [100_]            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Repository Configuration

`.opus-orchestra/isolation.json`:
```json
{
  // Minimum required tier (won't run with less isolation)
  "minimumTier": "docker",

  // Recommended tier
  "recommendedTier": "gvisor",

  // Custom image for this repo
  "image": "my-registry/my-sandbox:latest",
  "dockerfile": "./Dockerfile.sandbox",

  // Network allowlist additions
  "allowedDomains": [
    "api.github.com",
    "objects.githubusercontent.com"
  ],

  // Resource overrides
  "memoryLimit": "8g",
  "cpuLimit": "4",

  // Additional mounts (read-only recommended)
  "additionalMounts": [
    { "source": "./test-fixtures", "target": "/fixtures", "readonly": true }
  ],

  // Environment variables (non-sensitive only!)
  "environment": {
    "NODE_ENV": "development",
    "CI": "true"
  }
}
```

### Credential Management

**Credentials NEVER enter the sandbox. Instead:**

1. **Anthropic API**: Proxy injects `x-api-key` header
2. **GitHub API**: Proxy injects `Authorization: Bearer` header
3. **Package registries**: Proxy injects auth as needed
4. **Other APIs**: Configure in proxy, not in agent

**Explicitly NOT Available to Agents**:
- `~/.ssh/*` - SSH keys
- `~/.aws/*` - AWS credentials
- `~/.config/gh/*` - GitHub CLI auth
- `~/.gitconfig` - Git credentials
- `~/.netrc` - Stored passwords
- `~/.docker/config.json` - Docker registry auth
- `~/.kube/config` - Kubernetes credentials
- `*.pem`, `*.key` - Private keys
- `.env*` - Environment files with secrets

### Visual Differentiation

Different visual treatment per tier:

| Tier | Border Color | Icon | Label |
|------|--------------|------|-------|
| Standard | Default | Terminal | "Standard" |
| Sandbox | Light Blue | Shield | "Sandboxed" |
| Docker | Blue | Container | "Contained" |
| gVisor | Purple | Shield+ | "gVisor" |
| Cloud Hypervisor | Green | VM | "VM Isolated" |

### Workflow

1. User creates agent, selects isolation tier (or uses default)
2. Extension checks tier prerequisites:
   - Sandbox: Check for bubblewrap/sandbox-exec
   - Docker: Check Docker daemon running
   - gVisor: Check runsc runtime available
   - Cloud Hypervisor: Check binary and KVM permissions
3. Extension starts proxy service (if not running)
4. Extension creates isolated environment:
   - Mount worktree
   - Configure network to use proxy
   - Set resource limits
5. Claude starts with `--dangerously-skip-permissions`
6. Agent works autonomously
7. User reviews final diff
8. Approve → keep changes, Reject → `git reset --hard`
9. Environment destroyed

### Security Model

| Threat | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|--------|--------|--------|--------|--------|
| Arbitrary code | Contained | Contained | Contained | Contained |
| Data exfiltration | Proxy blocks | Proxy blocks | Proxy blocks | Proxy blocks |
| Credential theft | Not mounted | Not mounted | Not mounted | Not mounted |
| Kernel exploit | Vulnerable | Vulnerable | Protected | Protected |
| Container escape | N/A | Possible | Very hard | N/A (VM) |
| Resource exhaustion | Limits | Limits | Limits | Limits |
| Persistent malware | Ephemeral | Ephemeral | Ephemeral | Ephemeral |

### Implementation Steps

1. **Proxy Service**:
   - HTTP/HTTPS proxy with domain allowlist
   - Credential injection for configured services
   - Request logging
   - Unix socket and TCP listeners
   - TLS termination (optional)

2. **Sandbox Runtime Integration**:
   - Integrate `@anthropic-ai/sandbox-runtime`
   - Configuration file generation
   - Process management

3. **Docker Integration** (existing, enhance):
   - Hardened container creation
   - Unix socket networking
   - gVisor runtime support
   - Seccomp profiles

4. **Cloud Hypervisor Integration**:
   - VM lifecycle management
   - vsock communication
   - virtio-fs mounts
   - Kernel/rootfs management

5. **Settings UI**:
   - Tier selection with explanations
   - Prerequisites checker
   - Domain allowlist editor

6. **Visual Updates**:
   - Per-tier styling
   - Isolation indicator on cards
   - Resource usage display

## Open Questions

1. **Proxy implementation**: Build custom or use existing (Envoy, etc.)?
2. **Cloud Hypervisor on Windows**: WSL2 with KVM support required
3. **macOS Cloud Hypervisor**: Not supported - what's the fallback?
4. **Tier upgrades**: Can a running agent be "upgraded" to higher isolation?

## Dependencies

- Tier 1: `bubblewrap` (Linux) or `sandbox-exec` (macOS)
- Tier 2: Docker
- Tier 3: Docker + gVisor (runsc)
- Tier 4: Cloud Hypervisor + Linux with KVM

## Risks

- Complexity across tiers → good defaults, clear UI
- Platform differences → document requirements per platform
- Performance overhead → show expected overhead in UI
- Proxy as single point of failure → robust error handling
