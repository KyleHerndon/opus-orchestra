# Dependency Injection

## Overview

Opus Orchestra uses **constructor injection** for dependencies. This makes code testable, explicit about dependencies, and avoids hidden global state.

## Why DI Over Singletons?

### The Problem with Singletons

```typescript
// Singleton pattern (avoid this)
let instance: ConfigService | null = null;

export function getConfigService(): ConfigService {
  if (!instance) {
    instance = new ConfigService();
  }
  return instance;
}

// Usage - hidden dependency
class AgentManager {
  doSomething() {
    const config = getConfigService(); // Where does this come from?
    // ...
  }
}
```

Problems:
1. **Hidden dependencies** - Can't tell what AgentManager needs without reading the code
2. **Hard to test** - Can't substitute a mock without global state manipulation
3. **Initialization order** - Singletons initialize lazily, causing subtle bugs
4. **Circular dependencies** - Easy to create, hard to debug

### Constructor Injection

```typescript
// Constructor injection (preferred)
class AgentManager {
  constructor(
    private config: ConfigAdapter,
    private system: SystemAdapter,
    private eventBus: IEventBus
  ) {}

  doSomething() {
    const value = this.config.get('defaultAgentCount');
    // ...
  }
}

// Explicit wiring at composition root
const config = new VSCodeConfigAdapter();
const system = new NodeSystemAdapter('wsl');
const eventBus = new EventBus();
const agentManager = new AgentManager(config, system, eventBus);
```

Benefits:
1. **Explicit dependencies** - Constructor signature documents requirements
2. **Easy to test** - Pass mocks directly
3. **No global state** - Each instance is independent
4. **Clear initialization** - Wiring happens in one place

## Composition Root

The **composition root** is where all dependencies are wired together. For VS Code, this is `extension.ts`:

```typescript
// packages/vscode/src/extension.ts
export function activate(context: vscode.ExtensionContext) {
  // 1. Create adapters
  const system = new NodeSystemAdapter(getTerminalType());
  const storage = new VSCodeStorageAdapter();
  storage.initialize(context);
  const config = new VSCodeConfigAdapter();
  const ui = new VSCodeUIAdapter();
  const terminal = new VSCodeTerminalAdapter(system);

  // 2. Create core services
  const logger = new Logger(context.extensionPath);
  const eventBus = new EventBus(logger);
  const gitService = new GitService(system, logger);
  const statusService = new StatusService(system, logger);
  const tmuxService = new TmuxService(system, config.get('tmuxSessionPrefix'), logger);

  // 3. Create managers
  const worktreeManager = new WorktreeManager(system, config, logger);
  const statusTracker = new AgentStatusTracker(
    statusService, gitService, eventBus, config, logger
  );
  const persistence = new AgentPersistence(worktreeManager, storage, logger);

  // 4. Create main orchestrator
  const agentManager = new AgentManager(
    system, config, ui, terminal, eventBus,
    worktreeManager, statusTracker, persistence, logger
  );

  // 5. Wire up UI
  // ...
}
```

## Dependency Graph

```
                    ┌─────────────┐
                    │   Logger    │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│ GitService  │   │StatusService│   │ TmuxService │
└──────┬──────┘   └──────┬──────┘   └──────┬──────┘
       │                 │                 │
       │    ┌────────────┼────────────┐    │
       │    │            │            │    │
       ▼    ▼            ▼            ▼    ▼
┌─────────────────────────────────────────────────┐
│                 SystemAdapter                    │
└─────────────────────────────────────────────────┘
```

## Testing with DI

### Unit Tests

```typescript
describe('WorktreeManager', () => {
  let system: MockSystemAdapter;
  let config: MockConfigAdapter;
  let manager: WorktreeManager;

  beforeEach(() => {
    // Create mocks
    system = new MockSystemAdapter();
    config = new MockConfigAdapter({
      worktreeDirectory: '.worktrees',
    });

    // Inject mocks
    manager = new WorktreeManager(system, config);
  });

  it('checks if worktree exists', () => {
    system.createDirectory('/project/.worktrees/claude-alpha');

    expect(manager.worktreeExists('/project/.worktrees/claude-alpha')).toBe(true);
    expect(manager.worktreeExists('/project/.worktrees/claude-bravo')).toBe(false);
  });
});
```

### Integration Tests

```typescript
describe('AgentManager integration', () => {
  let system: NodeSystemAdapter;
  let agentManager: AgentManager;

  beforeEach(() => {
    // Use real implementations with test config
    system = new NodeSystemAdapter('bash');
    const config = new FileConfigAdapter('./test-config.json');
    // ... wire up other dependencies
  });

  it('creates agents end-to-end', async () => {
    await agentManager.createAgents(2, '/tmp/test-repo');
    expect(agentManager.getAgents()).toHaveLength(2);
  });
});
```

## Adapter Interfaces

Each adapter interface defines a contract that implementations must fulfill:

```typescript
// Core defines interface
interface StorageAdapter {
  get<T>(key: string, defaultValue: T): T;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

// VS Code implementation
class VSCodeStorageAdapter implements StorageAdapter {
  private context: vscode.ExtensionContext;

  get<T>(key: string, defaultValue: T): T {
    return this.context.workspaceState.get(key, defaultValue);
  }
  // ...
}

// Mock for testing
class MockStorageAdapter implements StorageAdapter {
  private data = new Map<string, unknown>();

  get<T>(key: string, defaultValue: T): T {
    return (this.data.get(key) as T) ?? defaultValue;
  }
  // ...
}
```

## Optional Dependencies

For optional dependencies, use `undefined` with null checks:

```typescript
class GitService {
  constructor(
    private system: SystemAdapter,
    private logger?: ILogger  // Optional
  ) {}

  isGitRepo(path: string): boolean {
    this.logger?.debug(`Checking if ${path} is a git repo`);
    // ...
  }
}
```

## Circular Dependencies

DI helps avoid circular dependencies. If you find yourself needing circular refs:

1. **Extract shared logic** - Create a new service both depend on
2. **Use events** - Communicate via EventBus instead of direct calls
3. **Lazy injection** - Pass a factory function instead of instance

```typescript
// Instead of circular A <-> B
// Use events:
class ServiceA {
  constructor(private eventBus: IEventBus) {
    eventBus.on('b:updated', () => this.handleBUpdate());
  }
}

class ServiceB {
  constructor(private eventBus: IEventBus) {}

  update() {
    this.eventBus.emit('b:updated', {});
  }
}
```

## Guidelines

1. **Inject interfaces, not implementations** - Depend on `SystemAdapter`, not `NodeSystemAdapter`
2. **Wire at composition root** - Don't create dependencies inside classes
3. **Keep constructors simple** - Just assign dependencies, no complex logic
4. **Favor fewer dependencies** - If a class needs many deps, it might be doing too much
5. **Make dependencies explicit** - No hidden `getInstance()` calls inside methods
