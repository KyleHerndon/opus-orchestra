# Containerized Agent Mode

## Summary

Run agents in Docker containers with `--dangerously-skip-permissions` for autonomous operation while maintaining security through isolation.

## Motivation

Currently, agents require manual approval for every file write, bash command, etc. This creates a high-friction workflow where the user is constantly context-switching to approve routine operations.

A containerized mode allows agents to run autonomously within a sandboxed environment. The user reviews the final diff rather than individual operations, dramatically reducing interruptions while maintaining security.

## Design

### Architecture

```
┌─────────────────────────────────────────────────────┐
│ VS Code Extension (Host)                            │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Agent 1 (Containerized)    Agent 2 (Standard)      │
│  ┌───────────────────────┐  ┌───────────────────┐   │
│  │ Docker Container      │  │ VS Code Terminal  │   │
│  │ ├─ Worktree (mounted) │  │ ├─ Manual approve │   │
│  │ ├─ No network         │  │ └─ Full host      │   │
│  │ ├─ No host access     │  │     access        │   │
│  │ └─ Skip permissions   │  │                   │   │
│  └───────────────────────┘  └───────────────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Container Image Selection

**Priority Order**:
1. **Repository-provided image**: Check for `.opus-orchestra/Dockerfile` or `.opus-orchestra/container-image` in repo
2. **User setting**: `claudeAgents.containerImage` in VS Code settings
3. **Default image**: `ghcr.io/kyleherndon/opus-orchestra-sandbox:latest`

**Repository Configuration** (`.opus-orchestra/container.json`):
```json
{
  "image": "my-custom-image:latest",
  "dockerfile": "./Dockerfile",
  "buildContext": ".",
  "network": "none",
  "memoryLimit": "8g",
  "cpuLimit": "4",
  "additionalMounts": [
    { "source": "./test-fixtures", "target": "/fixtures", "readonly": true }
  ],
  "environment": {
    "NODE_ENV": "development"
  }
}
```

This allows projects to:
- Use a custom image with project-specific dependencies pre-installed
- Provide a Dockerfile that extends the default image
- Override resource limits for resource-intensive projects
- Mount additional directories needed for the project

**Default Image** (provided by Opus Orchestra):

Debian/Ubuntu slim with:
- Node.js LTS
- Python 3
- Git
- Claude Code CLI
- Common build tools (make, gcc, etc.)
- Common language runtimes (Go, Rust toolchain)

**Security Configuration** (applied regardless of image):
- `--network none` by default
- No privileged mode
- No docker socket access
- Memory limit (default 4GB)
- CPU limit (default 2 cores)
- Read-only root filesystem (except /tmp and worktree)
- No access to host paths except mounted worktree
- **No access to host credentials** (~/.ssh, ~/.aws, ~/.config/gh, etc.)

**Volume Mounts**:
- Worktree directory (read-write)
- Claude config for authentication (read-only, Claude API key only)
- Optional: package cache for faster installs

**Explicitly NOT Mounted** (credential isolation):
- `~/.ssh` - No SSH keys
- `~/.aws` - No AWS credentials
- `~/.config/gh` - No GitHub CLI auth
- `~/.gitconfig` - No git credentials
- `~/.netrc` - No stored passwords
- Any credential helpers or keychains

### Settings

```json
{
  "claudeAgents.containerMode": {
    "type": "boolean",
    "default": false,
    "description": "Run agents in Docker containers for autonomous operation"
  },
  "claudeAgents.containerImage": {
    "type": "string",
    "default": "ghcr.io/kyleherndon/opus-orchestra-sandbox:latest",
    "description": "Docker image for containerized agents (overridden by repo config)"
  },
  "claudeAgents.containerNetwork": {
    "type": "string",
    "enum": ["none", "bridge", "host"],
    "default": "none",
    "description": "Container network mode"
  },
  "claudeAgents.containerMemoryLimit": {
    "type": "string",
    "default": "4g",
    "description": "Container memory limit"
  },
  "claudeAgents.containerCpuLimit": {
    "type": "string",
    "default": "2",
    "description": "Container CPU limit"
  },
  "claudeAgents.containerAllowNetworkFor": {
    "type": "array",
    "default": [],
    "description": "Hostnames to allow network access to (e.g., registry.npmjs.org)"
  },
  "claudeAgents.containerUseRepoConfig": {
    "type": "boolean",
    "default": true,
    "description": "Use repository-provided container configuration if available"
  }
}
```

### Workflow

1. User creates agent with containerized mode enabled
2. Extension checks for Docker availability
3. Extension determines container image:
   - Check `.opus-orchestra/container.json` in repo
   - Fall back to user setting or default image
   - Build from Dockerfile if specified
4. Extension spawns container with:
   - Worktree mounted at `/workspace`
   - Claude credentials mounted read-only
   - Resource limits applied
5. Claude starts with `--dangerously-skip-permissions`
6. Agent works autonomously
7. When agent signals completion (or user checks in):
   - Show git diff summary in dashboard
   - User reviews changes
   - Approve → keep changes, Reject → `git reset --hard`
8. Container is stopped/removed

### Visual Differentiation

Containerized agents must be visually distinct in the UI:

**Dashboard**:
- Different card color/border (e.g., blue border for containerized, default for standard)
- Container icon badge on agent card
- Status shows "Containerized" or "Sandboxed" mode
- "Review Changes" button instead of approval queue
- Resource usage display (memory/CPU from container stats)

**Sidebar**:
- Different icon for containerized agents
- Tooltip indicates container mode
- Context menu has container-specific options (restart container, view logs)

**Status Bar**:
- Separate count for containerized vs standard agents
- e.g., "Agents: 2 standard, 3 containerized"

### Reload from Disk

Containerized agents should support reloading state from disk:

**Use Cases**:
- VS Code restarts while containers are still running
- Extension reloads/updates
- Recovering from extension crashes
- Switching between VS Code windows

**Implementation**:
- Persist container ID to workspace state
- On extension activation, scan for running containers with our labels
- Reconnect to existing containers
- Restore agent state from persisted data + container inspection
- If container died, show "Container stopped" status with restart option

**Container Labels**:
```
opus-orchestra.agent-id=<agent-id>
opus-orchestra.worktree-path=<path>
opus-orchestra.repo-path=<path>
opus-orchestra.session-id=<session-id>
```

**Recovery Flow**:
1. Extension activates
2. Query Docker for containers with `opus-orchestra.*` labels
3. For each found container:
   - Check if running
   - Match to persisted agent data
   - Restore agent in UI
   - Reattach output streams
4. For containers that stopped:
   - Show in UI with "stopped" status
   - Offer restart or cleanup options

### Security Model

| Threat | Mitigation |
|--------|------------|
| Arbitrary code execution | Contained, isolated from host |
| Data exfiltration | No network by default |
| Credential theft | No access to ~/.ssh, ~/.aws, ~/.config/gh, ~/.gitconfig, ~/.netrc |
| GitHub token theft | gh CLI auth explicitly not mounted |
| SSH key theft | ~/.ssh explicitly not mounted |
| Resource exhaustion | Memory/CPU limits enforced |
| Container escape | Unprivileged, no capabilities, seccomp profile |
| Persistent malware | Container destroyed after use |
| Worktree poisoning | User reviews diff before merge |

### Implementation Steps

1. **Dockerfile**: Create default sandbox image, publish to ghcr.io
2. **Repo Config Parser**: Read `.opus-orchestra/container.json` from repos
3. **Container Manager**: New class to handle Docker lifecycle
   - `getImageForRepo()`: Determine which image to use
   - `buildImage()`: Build from Dockerfile
   - `pullImage()`: Pull from registry
   - `createContainer()`: Spawn with correct mounts/limits
   - `startContainer()`: Start and attach
   - `stopContainer()`: Graceful shutdown
   - `removeContainer()`: Cleanup
   - `listOurContainers()`: Find containers with our labels
   - `reconnectContainer()`: Reattach to running container
4. **Agent Manager Changes**:
   - New `createContainerizedAgent()` method
   - Modify terminal creation to optionally use container
   - Add container status to agent state
   - Add `restoreContainerizedAgents()` for reload from disk
5. **Dashboard Changes**:
   - Visual distinction for containerized agents
   - Show container vs standard mode indicator
   - Add "Review Changes" button for containerized agents
   - Diff viewer for reviewing changes
   - Container resource usage display
6. **Sidebar Changes**:
   - Different icons for container mode
   - Container-specific context menu items
7. **Settings UI**: Container configuration options
8. **Persistence**: Store container IDs and restore on reload

## Open Questions

1. **Package installation**: Pre-bake common dependencies? Allow network access to registries? Mount a shared cache?
2. **Authentication**: How to safely pass Claude credentials into container?
3. **Build output**: Some projects need to run builds - how to handle build artifacts?
4. **Windows support**: Docker Desktop on Windows has different behavior - test thoroughly
5. **Podman support**: Alternative to Docker for users who prefer it?

## Dependencies

- Docker installed on host
- Sufficient disk space for container images
- User has permissions to run Docker commands

## Risks

- Docker not installed → graceful fallback to standard mode
- Container build failures → provide clear error messages
- Performance overhead → should be minimal, monitor
- WSL2 Docker quirks → test extensively on Windows
- Malicious repo Dockerfile → warn user when using repo-provided images
