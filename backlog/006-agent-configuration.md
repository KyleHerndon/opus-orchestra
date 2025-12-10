# Agent Configuration Profiles

## Summary

Sane defaults for Claude settings, plus the ability to compose configurations from multiple profiles for different agent types and security contexts.

## Motivation

Currently, each agent starts with whatever Claude defaults exist. Users must:
- Manually configure each agent
- Remember which permissions to grant
- Repeat configuration for similar agents

Better configuration support would provide:
- Sensible defaults out of the box
- Reusable profiles for different agent types
- Composable configs (base + role-specific + project-specific)
- Easy switching between security contexts

## Design

### Configuration Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│ Final Agent Config                                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐                                        │
│  │   Defaults  │  ← Opus Orchestra sane defaults        │
│  └──────┬──────┘                                        │
│         ▼                                               │
│  ┌─────────────┐                                        │
│  │   Project   │  ← .opus-orchestra/config.json         │
│  └──────┬──────┘                                        │
│         ▼                                               │
│  ┌─────────────┐                                        │
│  │   Profile   │  ← Selected profile(s)                 │
│  └──────┬──────┘                                        │
│         ▼                                               │
│  ┌─────────────┐                                        │
│  │   Agent     │  ← Per-agent overrides                 │
│  └─────────────┘                                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Each layer can override or extend the previous.

### Default Configuration

Sane defaults that ship with Opus Orchestra:

```json
{
  "claude": {
    "model": "claude-sonnet-4-20250514",
    "maxTokens": 8192,
    "temperature": 0.7
  },
  "permissions": {
    "fileRead": "ask",
    "fileWrite": "ask",
    "bash": "ask",
    "webSearch": "ask",
    "mcp": "ask"
  },
  "behavior": {
    "autoCommit": false,
    "branchNaming": "agent-{n}",
    "commitMessagePrefix": "[Agent-{n}]"
  },
  "restrictions": {
    "blockedCommands": [
      "rm -rf /", "sudo", "chmod 777",
      "gh auth *", "gh api *", "gh pr create", "gh issue *",
      "cat ~/.config/gh/*", "cat ~/.ssh/*", "cat ~/.aws/*",
      "cat ~/.netrc", "cat ~/.gitconfig"
    ],
    "blockedPaths": [
      ".env", "*.pem", "*.key", "credentials.*",
      "~/.config/gh/*", "~/.ssh/*", "~/.aws/*", "~/.netrc"
    ],
    "maxFileSize": "1MB"
  }
}
```

### Built-in Profiles

**"conservative"** (default for standard agents):
```json
{
  "name": "conservative",
  "description": "Requires approval for all operations",
  "permissions": {
    "fileRead": "ask",
    "fileWrite": "ask",
    "bash": "ask"
  }
}
```

**"trusted-read"** (for research/exploration):
```json
{
  "name": "trusted-read",
  "description": "Can read freely, asks for writes",
  "permissions": {
    "fileRead": "allow",
    "fileWrite": "ask",
    "bash": "ask"
  }
}
```

**"containerized"** (for sandboxed execution):
```json
{
  "name": "containerized",
  "description": "Full autonomy within container",
  "permissions": {
    "fileRead": "allow",
    "fileWrite": "allow",
    "bash": "allow"
  },
  "restrictions": {
    "requireContainer": true
  }
}
```

**"conductor"** (for coordinator agent):
```json
{
  "name": "conductor",
  "description": "Read-only, manages coordination files",
  "permissions": {
    "fileRead": "allow",
    "fileWrite": "ask",
    "bash": "deny"
  },
  "restrictions": {
    "allowedPaths": [".claude-coordination/*"],
    "blockedPaths": ["src/*", "*.ts", "*.js"]
  }
}
```

### Profile Composition

Agents can use multiple profiles that merge together:

```
Agent Config = defaults + profile:conservative + profile:frontend + project
```

**Merge Rules**:
- Later profiles override earlier ones
- Arrays are concatenated (e.g., blockedPaths)
- Objects are deep-merged
- Explicit `null` removes a value

### Settings UI

**Profile Manager**:
```
┌─────────────────────────────────────────────────────────┐
│ Configuration Profiles                                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Built-in Profiles:                                      │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ● conservative    Requires approval for all ops     │ │
│ │ ○ trusted-read    Can read freely, asks for writes  │ │
│ │ ○ containerized   Full autonomy within container    │ │
│ │ ○ conductor       Read-only coordinator             │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Custom Profiles:                                        │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ○ frontend-dev    Frontend with npm allowed         │ │
│ │ ○ backend-api     Backend with db access            │ │
│ │ [+ Create Profile]                                  │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Default for new agents: [conservative ▼]               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Profile Editor**:
```
┌─────────────────────────────────────────────────────────┐
│ Edit Profile: frontend-dev                   [Save] [×] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Name: [frontend-dev_______]                             │
│ Description: [Frontend development with npm_______]     │
│                                                         │
│ Base Profile: [conservative ▼] (inherits from)         │
│                                                         │
│ Permissions:                                            │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ File Read:    [allow ▼]                             │ │
│ │ File Write:   [ask ▼]                               │ │
│ │ Bash:         [ask ▼]                               │ │
│ │ Web Search:   [deny ▼]                              │ │
│ │ MCP Tools:    [ask ▼]                               │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Allowed Commands:                                       │
│ [npm install] [npm run *] [npx *] [+ Add]              │
│                                                         │
│ Blocked Paths:                                          │
│ [.env*] [*.key] [+ Add]                                │
│                                                         │
│ Allowed Paths (override blocks):                        │
│ [src/components/*] [src/styles/*] [+ Add]              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Agent Profile Assignment**:
```
┌─────────────────────────────────────────────────────────┐
│ Agent-1 Configuration                                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Applied Profiles (in order):                            │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 1. conservative (base)                    [×]       │ │
│ │ 2. frontend-dev                           [×]       │ │
│ │ [+ Add Profile]                                     │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Agent Overrides:                                        │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ (none - using profile defaults)                     │ │
│ │ [+ Add Override]                                    │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Effective Config: [View Merged Config]                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Project Configuration

Projects can provide defaults in `.opus-orchestra/config.json`:

```json
{
  "defaultProfile": "conservative",
  "profiles": {
    "project-backend": {
      "description": "Backend work for this project",
      "extends": "trusted-read",
      "permissions": {
        "bash": "ask"
      },
      "restrictions": {
        "allowedCommands": ["go build", "go test", "make"],
        "allowedPaths": ["cmd/*", "internal/*", "pkg/*"]
      }
    }
  },
  "agentDefaults": {
    "behavior": {
      "branchNaming": "feature/agent-{n}-{task}",
      "commitMessagePrefix": ""
    }
  }
}
```

### Claude Settings Integration

Map profile settings to Claude Code's actual configuration:

**settings.json generation**:
```json
{
  "permissions": {
    "allow": [
      "Read(*)",
      "Write(src/components/*)",
      "Bash(npm install)"
    ],
    "deny": [
      "Write(.env*)",
      "Bash(rm -rf *)"
    ]
  }
}
```

**CLAUDE.md injection**:
Profiles can include instructions added to CLAUDE.md:
```json
{
  "claudeInstructions": [
    "You are working on frontend components.",
    "Do not modify backend code.",
    "Run `npm test` before committing."
  ]
}
```

### Implementation Steps

1. **Config Schema**:
   - Define TypeScript types for config
   - JSON Schema for validation
   - Default values
2. **Config Merger**:
   - Deep merge logic
   - Array concatenation
   - Null handling for removal
3. **Profile Storage**:
   - Built-in profiles (bundled)
   - User profiles (VS Code settings)
   - Project profiles (.opus-orchestra/)
4. **Settings UI**:
   - Profile manager panel
   - Profile editor form
   - Agent profile assignment
   - Merged config viewer
5. **Claude Integration**:
   - Generate settings.json for agent
   - Inject CLAUDE.md instructions
   - Handle permission mapping
6. **Agent Creation Flow**:
   - Profile selection in create dialog
   - Apply profiles at agent startup
   - Support runtime profile changes

## Example Workflows

**New frontend agent**:
1. Create agent
2. Select profiles: conservative + frontend-dev
3. Agent can read all files, npm commands auto-approved
4. Write operations still require approval

**Containerized backend agent**:
1. Create containerized agent
2. Select profiles: containerized + project-backend
3. Full autonomy inside container
4. Restricted to backend paths

**Conductor agent**:
1. Designate agent as conductor
2. Automatically applies conductor profile
3. Read-only except for coordination files

## Open Questions

1. **Profile versioning**: Handle profile changes for running agents?
2. **Import/export**: Share profiles between projects?
3. **Validation**: How strictly to enforce restrictions?

## Dependencies

- Container mode (see 001-containerized-mode.md) for containerized profile
- Conductor agent (see 004-conductor-agent.md) for conductor profile

## Credential Isolation

**Agents must NEVER have access to user credentials.**

All default profiles include blocks for:
- `gh` CLI commands (GitHub auth)
- SSH key access (`~/.ssh/*`)
- AWS credentials (`~/.aws/*`)
- Git credentials (`~/.gitconfig`, `~/.netrc`)
- Any credential stores

**Why this matters**:
- Agents could push to repos as you
- Agents could access private repos/APIs
- Agents could exfiltrate credentials
- Compromised agents become full account compromise

**Implementation**:
- Default blockedCommands includes `gh *`, credential file access
- Default blockedPaths includes credential directories
- Containerized mode explicitly doesn't mount credential paths
- GitHub operations go through extension, not agents

Users CAN override these blocks, but must do so explicitly and understand the risk.

## Risks

- Config complexity → good defaults, simple UI
- Merge conflicts → clear precedence rules
- Security bypass → restrictions are advisory in non-container mode
- Credential exposure → strong defaults, explicit opt-in for overrides
