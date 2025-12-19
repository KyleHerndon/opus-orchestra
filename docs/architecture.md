# Opus Orchestra Architecture

## Overview

Opus Orchestra uses a **layered architecture** that separates platform-agnostic business logic from UI-specific implementations. This enables:

- Testing core logic without spinning up VS Code
- Building alternative UIs (terminal, web server)
- Clean separation of concerns

```
┌─────────────────────────────────────────────────────────────┐
│                        UI Layer                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │   VS Code   │  │  Terminal   │  │ Web Server  │  (future)│
│  │  Extension  │  │     CLI     │  │     API     │          │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘          │
└─────────┼────────────────┼────────────────┼─────────────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│                     Adapter Layer                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  VSCode*Adapter  │  Terminal*Adapter  │  Web*Adapter │   │
│  └─────────────────────────────────────────────────────┘    │
│         │                    │                   │           │
│         ▼                    ▼                   ▼           │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Adapter Interfaces (Core)               │    │
│  │  SystemAdapter │ TerminalAdapter │ UIAdapter │ etc.  │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                       Core Layer                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │   Managers  │  │  Services   │  │ Containers  │          │
│  │ AgentMgr    │  │ GitService  │  │ DockerAdapt │          │
│  │ WorktreeMgr │  │ StatusSvc   │  │ UnisolatedA │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│                         │                                    │
│                         ▼                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                    Types                             │    │
│  │  Agent │ Container │ Events │ Hooks                  │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Package Structure

```
opus-orchestra/
├── packages/
│   ├── core/                 # Platform-agnostic logic
│   │   └── src/
│   │       ├── adapters/     # Adapter INTERFACES
│   │       ├── types/        # Type definitions
│   │       ├── services/     # Business services
│   │       ├── managers/     # State managers
│   │       └── containers/   # Container adapters
│   │
│   └── vscode/              # VS Code extension
│       └── src/
│           ├── adapters/    # VS Code adapter IMPLEMENTATIONS
│           ├── services/    # VS Code-specific services
│           └── ui/          # Webviews, panels
│
└── docs/                    # Documentation
```

## Key Principles

### 1. Core Has No Platform Dependencies

The `@opus-orchestra/core` package has **zero** dependencies on:
- VS Code APIs (`vscode` module)
- OS-specific code (`os.platform()`, `process.platform`)
- Platform-specific paths (`C:\`, `/mnt/c/`, `\\wsl$\`)

All platform-specific behavior is encapsulated in adapter implementations.

### 2. Adapters Are the Boundary

Adapters define the boundary between core logic and platform-specific code:

```typescript
// Core defines the interface
interface SystemAdapter {
  execSync(command: string, cwd: string): string;
  convertPath(path: string, context: PathContext): string;
  // ...
}

// VS Code package provides implementation
class NodeSystemAdapter implements SystemAdapter {
  // Uses Node.js APIs, handles Windows/WSL/macOS/Linux
}
```

### 3. Dependency Injection Over Singletons

Core classes accept their dependencies via constructor:

```typescript
// Good: Dependencies injected
class GitService {
  constructor(system: SystemAdapter, logger?: ILogger) {
    this.system = system;
    this.logger = logger;
  }
}

// Bad: Global singletons
class GitService {
  constructor() {
    this.system = getSystemAdapter(); // Hidden dependency
  }
}
```

### 4. Events for Cross-Cutting Concerns

The EventBus enables loose coupling between components:

```typescript
// Emit events when state changes
eventBus.emit('agent:created', { agent });

// Subscribe to events from anywhere
eventBus.on('agent:created', ({ agent }) => {
  updateUI(agent);
});
```

## Adapter Types

| Adapter | Purpose | Core Interface | VS Code Implementation |
|---------|---------|----------------|------------------------|
| SystemAdapter | OS operations, paths, commands | `SystemAdapter` | `NodeSystemAdapter` |
| TerminalAdapter | Terminal creation/management | `TerminalAdapter` | `VSCodeTerminalAdapter` |
| StorageAdapter | Persistent storage | `StorageAdapter` | `VSCodeStorageAdapter` |
| ConfigAdapter | Configuration access | `ConfigAdapter` | `VSCodeConfigAdapter` |
| UIAdapter | User notifications/prompts | `UIAdapter` | `VSCodeUIAdapter` |

## Data Flow

```
User Action (VS Code)
        │
        ▼
┌─────────────────┐
│ VS Code Command │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  AgentManager   │────▶│   WorktreeMgr   │
│     (core)      │     │     (core)      │
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│  SystemAdapter  │     │   GitService    │
│ (injected impl) │     │     (core)      │
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
┌─────────────────────────────────────────┐
│           Operating System              │
│  (file system, processes, terminals)    │
└─────────────────────────────────────────┘
```

## Testing Strategy

### Core Tests (Vitest)
- Use `MockSystemAdapter` for file/command operations
- Test business logic in isolation
- Fast, no VS Code runtime needed

### VS Code Tests (Mocha)
- Test VS Code adapter implementations
- Test UI components
- Requires VS Code runtime

See [testing.md](./testing.md) for details.
