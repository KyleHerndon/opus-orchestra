# Testing Strategy

## Overview

Opus Orchestra uses a two-tier testing strategy:

| Tier | Framework | Package | Purpose |
|------|-----------|---------|---------|
| Core Tests | Vitest | `@opus-orchestra/core` | Business logic, no VS Code |
| Extension Tests | Mocha | `opus-orchestra` (vscode) | UI, VS Code integration |

## Core Tests (Vitest)

### Why Vitest?

- **Fast** - Sub-second test runs
- **No VS Code** - Tests run in plain Node.js
- **Modern** - ESM support, TypeScript native
- **Great DX** - Watch mode, inline snapshots

### Running Tests

```bash
# Run once
cd packages/core
npm test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

### Test Structure

```
packages/core/src/
├── __tests__/
│   ├── adapters/
│   │   └── SystemAdapter.test.ts
│   ├── services/
│   │   ├── GitService.test.ts
│   │   └── StatusService.test.ts
│   ├── managers/
│   │   ├── WorktreeManager.test.ts
│   │   └── AgentStatusTracker.test.ts
│   └── mocks/
│       ├── MockSystemAdapter.ts
│       ├── MockConfigAdapter.ts
│       └── MockStorageAdapter.ts
```

### Writing Core Tests

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { GitService } from '../../services/GitService';
import { MockSystemAdapter } from '../mocks/MockSystemAdapter';

describe('GitService', () => {
  let system: MockSystemAdapter;
  let git: GitService;

  beforeEach(() => {
    system = new MockSystemAdapter();
    git = new GitService(system);
  });

  describe('isGitRepo', () => {
    it('returns true for git directories', () => {
      system.setExecResult('git rev-parse --git-dir', '.git\n');

      expect(git.isGitRepo('/project')).toBe(true);
    });

    it('returns false for non-git directories', () => {
      system.setExecError('git rev-parse --git-dir', 'not a git repo');

      expect(git.isGitRepo('/not-a-repo')).toBe(false);
    });
  });

  describe('getDiffStats', () => {
    it('parses diff output correctly', async () => {
      system.setExecResult(
        'git diff --shortstat main',
        ' 3 files changed, 45 insertions(+), 12 deletions(-)\n'
      );

      const stats = await git.getDiffStats('/project', 'main');

      expect(stats).toEqual({
        filesChanged: 3,
        insertions: 45,
        deletions: 12,
      });
    });
  });
});
```

### MockSystemAdapter

The `MockSystemAdapter` simulates file system and command execution:

```typescript
export class MockSystemAdapter implements SystemAdapter {
  private files = new Map<string, string>();
  private directories = new Set<string>();
  private execResults = new Map<string, string>();
  private execErrors = new Map<string, string>();

  // File system simulation
  writeFile(path: string, content: string): void {
    this.files.set(this.normalizePath(path), content);
    this.ensureParentDirs(path);
  }

  readFile(path: string): string {
    const content = this.files.get(this.normalizePath(path));
    if (content === undefined) {
      throw new Error(`ENOENT: no such file: ${path}`);
    }
    return content;
  }

  // Command simulation
  setExecResult(command: string, result: string): void {
    this.execResults.set(command, result);
  }

  setExecError(command: string, error: string): void {
    this.execErrors.set(command, error);
  }

  execSync(command: string, _cwd: string): string {
    if (this.execErrors.has(command)) {
      throw new Error(this.execErrors.get(command));
    }
    return this.execResults.get(command) ?? '';
  }
}
```

### Testing Async Code

```typescript
describe('StatusService', () => {
  it('polls status files', async () => {
    const system = new MockSystemAdapter();
    const status = new StatusService(system);

    // Set up mock file
    system.writeFile('/worktree/.opus-orchestra/status/session-123', JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    }));

    const result = status.checkStatus('/worktree');

    expect(result).toEqual({
      status: 'waiting-approval',
      pendingApproval: 'Bash: npm test',
    });
  });
});
```

## VS Code Extension Tests (Mocha)

### When to Use

- Testing VS Code API interactions
- Testing webview behavior
- End-to-end workflows

### Running Tests

```bash
cd packages/vscode
npm test
```

Note: Requires VS Code runtime, may not work in all environments (e.g., WSL without display).

### Test Structure

```
packages/vscode/src/test/
├── suite/
│   ├── extension.test.ts
│   ├── agentPanel.test.ts
│   └── containerAdapters.test.ts
└── runTest.ts
```

## Test Patterns

### Arrange-Act-Assert

```typescript
it('creates worktree', () => {
  // Arrange
  const system = new MockSystemAdapter();
  const config = new MockConfigAdapter({ worktreeDirectory: '.worktrees' });
  const manager = new WorktreeManager(system, config);

  // Act
  manager.createWorktree('/repo', '/repo/.worktrees/alpha', 'claude-alpha', 'main');

  // Assert
  expect(system.getExecHistory()).toContainEqual({
    command: 'git worktree add -B "claude-alpha" "/repo/.worktrees/alpha" "main"',
    cwd: '/repo',
  });
});
```

### Testing Events

```typescript
it('emits events on status change', () => {
  const eventBus = new EventBus();
  const events: unknown[] = [];
  eventBus.on('agent:statusChanged', (e) => events.push(e));

  const tracker = new AgentStatusTracker(
    mockStatusService,
    mockGitService,
    eventBus,
    mockConfig
  );

  // Simulate status change
  mockStatusService.setNextStatus({ status: 'working', pendingApproval: null });
  tracker.refreshStatus(agents);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    agent: expect.objectContaining({ id: 1 }),
    previousStatus: 'idle',
  });
});
```

### Testing Error Handling

```typescript
it('handles missing files gracefully', () => {
  const system = new MockSystemAdapter();
  // Don't create the file - simulate missing

  const service = new StatusService(system);
  const result = service.checkStatus('/nonexistent');

  expect(result).toBeNull();
});
```

## Coverage Goals

| Component | Target | Rationale |
|-----------|--------|-----------|
| Services | 90%+ | Core business logic |
| Managers | 80%+ | State management |
| Adapters | 70%+ | Interface compliance |
| Types | N/A | No runtime code |

## Best Practices

### 1. Test Behavior, Not Implementation

```typescript
// Good: Tests observable behavior
it('finds agents in worktrees', () => {
  system.createDirectory('/repo/.worktrees/claude-alpha');
  system.writeFile('/repo/.worktrees/claude-alpha/.opus-orchestra/agent.json', '{"id":1}');

  const agents = manager.scanWorktreesForAgents('/repo');

  expect(agents).toHaveLength(1);
  expect(agents[0].id).toBe(1);
});

// Bad: Tests implementation details
it('calls readDir then readFile', () => {
  // ...
  expect(system.readDir).toHaveBeenCalledBefore(system.readFile);
});
```

### 2. Use Descriptive Names

```typescript
// Good
describe('when worktree already exists', () => {
  it('restores agent from metadata instead of creating new', () => {});
});

// Bad
describe('test1', () => {
  it('works', () => {});
});
```

### 3. Keep Tests Independent

```typescript
// Good: Each test sets up its own state
beforeEach(() => {
  system = new MockSystemAdapter();
  manager = new WorktreeManager(system, config);
});

// Bad: Tests share mutable state
const system = new MockSystemAdapter(); // Shared!
```

### 4. Test Edge Cases

```typescript
describe('path handling', () => {
  it('handles paths with spaces', () => {});
  it('handles unicode characters', () => {});
  it('handles very long paths', () => {});
  it('handles empty paths', () => {});
});
```

## Debugging Tests

### Vitest

```bash
# Run specific test file
npm test -- src/__tests__/services/GitService.test.ts

# Run tests matching pattern
npm test -- -t "getDiffStats"

# Debug with console output
npm test -- --reporter=verbose
```

### VS Code

Use the VS Code debugger with the "Extension Tests" launch configuration.
