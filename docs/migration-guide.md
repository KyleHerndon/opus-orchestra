# Migration Guide: Singletons to Dependency Injection

## Overview

The codebase is transitioning from singleton service patterns to dependency injection. This guide explains the migration path and how to update code incrementally.

## Current State

### Legacy Pattern (Singletons)

The VS Code package currently uses singleton services:

```typescript
// Old pattern - singleton access
import { getConfigService, getLogger, getEventBus } from './services';

class MyService {
  doSomething() {
    const config = getConfigService();
    const logger = getLogger();
    // ...
  }
}
```

### New Pattern (Dependency Injection)

The new pattern uses constructor injection via `ServiceContainer`:

```typescript
// New pattern - injected dependencies
import { ConfigAdapter, ILogger } from '@opus-orchestra/core';

class MyService {
  constructor(
    private config: ConfigAdapter,
    private logger: ILogger
  ) {}

  doSomething() {
    const value = this.config.get('someKey');
    this.logger.debug('Something happened');
  }
}
```

## ServiceContainer

The `ServiceContainer` is the composition root that creates and wires all dependencies:

```typescript
// packages/vscode/src/ServiceContainer.ts
export class ServiceContainer {
  // Adapters
  public readonly system: SystemAdapter;
  public readonly storage: StorageAdapter;
  public readonly config: ConfigAdapter;
  public readonly ui: UIAdapter;
  public readonly terminal: TerminalAdapter;

  // Core services
  public readonly logger: ILogger;
  public readonly eventBus: IEventBus;
  public readonly gitService: IGitService;
  // ...
}
```

### Initialization

The container is initialized in `extension.ts`:

```typescript
export function activate(context: vscode.ExtensionContext) {
  // Initialize the container
  const container = initializeContainer(
    context.extensionPath,
    terminalType,
    context
  );

  // Use container services...
}
```

### Accessing Services

During migration, services can be accessed via convenience functions:

```typescript
import { getContainer, getCoreLogger, getSystemAdapter } from './ServiceContainer';

// Get the whole container
const container = getContainer();
const logger = container.logger;

// Or use convenience accessors
const logger = getCoreLogger();
const system = getSystemAdapter();
```

## Migration Steps

### Step 1: Use Container Accessors (Quick Win)

Replace singleton calls with container accessors:

```typescript
// Before
import { getLogger } from './services';
const logger = getLogger();

// After
import { getCoreLogger } from './ServiceContainer';
const logger = getCoreLogger();
```

### Step 2: Accept Dependencies in Constructor

For new code or when refactoring:

```typescript
// Before
class MyManager {
  constructor() {
    // Uses singletons internally
  }

  doWork() {
    const git = getGitService();
    git.getStatus(path);
  }
}

// After
class MyManager {
  constructor(private gitService: IGitService) {}

  doWork() {
    this.gitService.getStatus(path);
  }
}
```

### Step 3: Wire Up in extension.ts

```typescript
export function activate(context: vscode.ExtensionContext) {
  const container = initializeContainer(/*...*/);

  // Create managers with injected dependencies
  const myManager = new MyManager(container.gitService);
}
```

## Coexistence Strategy

During migration, both patterns coexist:

1. **New core code** uses interfaces from `@opus-orchestra/core`
2. **Existing VS Code code** continues using singletons
3. **Container** provides both patterns via accessors

```typescript
// Legacy code continues to work
const oldLogger = getLogger();  // Still works

// New code uses container
const newLogger = getCoreLogger();  // From container

// Both point to compatible implementations
```

## Interface Mapping

| Legacy Singleton | Core Interface | Container Property |
|-----------------|----------------|-------------------|
| `getConfigService()` | `ConfigAdapter` | `container.config` |
| `getLogger()` | `ILogger` | `container.logger` |
| `getEventBus()` | `IEventBus` | `container.eventBus` |
| `getGitService()` | `IGitService` | `container.gitService` |
| `getStatusService()` | `IStatusService` | `container.statusService` |
| `getTmuxService()` | `ITmuxService` | `container.tmuxService` |

## Testing Benefits

With DI, testing becomes simpler:

```typescript
// Before: Had to use reset functions
beforeEach(() => {
  resetConfigService();
  resetLogger();
  // ... reset all singletons
});

// After: Just create mocks
beforeEach(() => {
  const config = new MockConfigAdapter();
  const logger = new MockLogger();
  myService = new MyService(config, logger);
});
```

## Best Practices During Migration

1. **Don't mix patterns in one class** - Either use singletons OR injection
2. **Prefer injection for new code** - Easier to test
3. **Migrate leaf classes first** - Start with classes that don't depend on other services
4. **Keep legacy code working** - Don't break existing functionality

## Timeline

The migration is incremental:

1. **Phase 10 (Now)**: ServiceContainer created, coexists with singletons
2. **Future**: Gradually migrate managers to accept injected dependencies
3. **Future**: Remove singleton patterns entirely

## Example: Full Migration of a Service

### Before

```typescript
// services/MyService.ts
import { getConfigService, getLogger } from './services';

export class MyService {
  doWork(path: string): string {
    const config = getConfigService();
    const logger = getLogger();

    logger.debug(`Working on ${path}`);
    const value = config.worktreeDirectory;
    return `${path}/${value}`;
  }
}

let instance: MyService | null = null;
export function getMyService(): MyService {
  if (!instance) instance = new MyService();
  return instance;
}
```

### After

```typescript
// Core: services/MyService.ts
import { ConfigAdapter, ILogger } from '../adapters';

export interface IMyService {
  doWork(path: string): string;
}

export class MyService implements IMyService {
  constructor(
    private config: ConfigAdapter,
    private logger: ILogger
  ) {}

  doWork(path: string): string {
    this.logger.debug(`Working on ${path}`);
    const value = this.config.get('worktreeDirectory');
    return `${path}/${value}`;
  }
}

// VS Code: ServiceContainer.ts
export class ServiceContainer {
  public readonly myService: IMyService;

  constructor(/*...*/) {
    this.myService = new MyService(this.config, this.logger);
  }
}
```
