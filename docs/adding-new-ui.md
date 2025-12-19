# Adding a New UI

## Overview

The architecture is designed to support multiple UIs. This guide explains how to add a new UI (terminal CLI, web server, etc.) by implementing the adapter interfaces.

## What You Need to Implement

To create a new UI, implement these adapter interfaces from `@opus-orchestra/core`:

| Adapter | Purpose | Required |
|---------|---------|----------|
| `SystemAdapter` | OS operations | Use `NodeSystemAdapter` |
| `StorageAdapter` | Persistence | Yes |
| `ConfigAdapter` | Configuration | Yes |
| `UIAdapter` | User interaction | Yes |
| `TerminalAdapter` | Terminal management | Optional* |

*TerminalAdapter is only needed if your UI manages terminals.

## Example: Terminal CLI

Let's walk through creating a terminal-based CLI.

### 1. Create Package Structure

```
packages/
├── core/           # Shared (already exists)
├── vscode/         # VS Code UI (already exists)
└── cli/            # New CLI package
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts
        ├── adapters/
        │   ├── FileStorageAdapter.ts
        │   ├── FileConfigAdapter.ts
        │   └── TerminalUIAdapter.ts
        └── commands/
            ├── create.ts
            ├── list.ts
            └── delete.ts
```

### 2. package.json

```json
{
  "name": "@opus-orchestra/cli",
  "version": "0.1.0",
  "main": "dist/index.js",
  "bin": {
    "opus": "dist/index.js"
  },
  "dependencies": {
    "@opus-orchestra/core": "^0.1.0",
    "commander": "^11.0.0",
    "inquirer": "^9.0.0"
  }
}
```

### 3. Implement FileStorageAdapter

```typescript
// packages/cli/src/adapters/FileStorageAdapter.ts
import * as fs from 'fs';
import * as path from 'path';
import { StorageAdapter } from '@opus-orchestra/core';

export class FileStorageAdapter implements StorageAdapter {
  private data: Record<string, unknown> = {};
  private filePath: string;

  constructor(storageDir: string) {
    this.filePath = path.join(storageDir, 'opus-storage.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch {
      this.data = {};
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  get<T>(key: string, defaultValue: T): T {
    return (this.data[key] as T) ?? defaultValue;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.data[key] = value;
    this.save();
  }

  async delete(key: string): Promise<void> {
    delete this.data[key];
    this.save();
  }

  isAvailable(): boolean {
    return true;
  }

  keys(): string[] {
    return Object.keys(this.data);
  }

  async clear(): Promise<void> {
    this.data = {};
    this.save();
  }
}
```

### 4. Implement FileConfigAdapter

```typescript
// packages/cli/src/adapters/FileConfigAdapter.ts
import * as fs from 'fs';
import {
  ConfigAdapter,
  ExtensionConfig,
  DEFAULT_CONFIG,
  ConfigChangeCallback,
} from '@opus-orchestra/core';

export class FileConfigAdapter implements ConfigAdapter {
  private config: ExtensionConfig;
  private configPath: string;
  private callbacks: Set<ConfigChangeCallback> = new Set();

  constructor(configPath: string) {
    this.configPath = configPath;
    this.config = this.loadConfig();
  }

  private loadConfig(): ExtensionConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
      }
    } catch {
      // Fall through to default
    }
    return { ...DEFAULT_CONFIG };
  }

  get<K extends keyof ExtensionConfig>(key: K): ExtensionConfig[K] {
    return this.config[key];
  }

  getAll(): ExtensionConfig {
    return { ...this.config };
  }

  async update<K extends keyof ExtensionConfig>(
    key: K,
    value: ExtensionConfig[K]
  ): Promise<void> {
    this.config[key] = value;
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    for (const callback of this.callbacks) {
      callback(key);
    }
  }

  onDidChange(callback: ConfigChangeCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  refresh(): void {
    this.config = this.loadConfig();
  }
}
```

### 5. Implement TerminalUIAdapter

```typescript
// packages/cli/src/adapters/TerminalUIAdapter.ts
import inquirer from 'inquirer';
import {
  UIAdapter,
  QuickPickItem,
  QuickPickOptions,
  InputOptions,
  ProgressOptions,
  ProgressReporter,
  CancellationToken,
} from '@opus-orchestra/core';

export class TerminalUIAdapter implements UIAdapter {
  async showInfo(message: string, ...items: string[]): Promise<string | undefined> {
    console.log(`ℹ️  ${message}`);
    if (items.length > 0) {
      const { choice } = await inquirer.prompt([{
        type: 'list',
        name: 'choice',
        message: 'Choose an action:',
        choices: [...items, 'Cancel'],
      }]);
      return choice === 'Cancel' ? undefined : choice;
    }
    return undefined;
  }

  async showWarning(message: string, ...items: string[]): Promise<string | undefined> {
    console.log(`⚠️  ${message}`);
    if (items.length > 0) {
      const { choice } = await inquirer.prompt([{
        type: 'list',
        name: 'choice',
        message: 'Choose an action:',
        choices: [...items, 'Cancel'],
      }]);
      return choice === 'Cancel' ? undefined : choice;
    }
    return undefined;
  }

  async showError(message: string, ...items: string[]): Promise<string | undefined> {
    console.error(`❌ ${message}`);
    if (items.length > 0) {
      const { choice } = await inquirer.prompt([{
        type: 'list',
        name: 'choice',
        message: 'Choose an action:',
        choices: [...items, 'Cancel'],
      }]);
      return choice === 'Cancel' ? undefined : choice;
    }
    return undefined;
  }

  async promptInput(options: InputOptions): Promise<string | undefined> {
    const { value } = await inquirer.prompt([{
      type: 'input',
      name: 'value',
      message: options.prompt,
      default: options.value,
      validate: options.validateInput
        ? (input) => options.validateInput!(input) ?? true
        : undefined,
    }]);
    return value || undefined;
  }

  async promptQuickPick(
    items: QuickPickItem[],
    options?: QuickPickOptions
  ): Promise<string | string[] | undefined> {
    const choices = items.map(item => ({
      name: item.description ? `${item.label} - ${item.description}` : item.label,
      value: item.value,
    }));

    if (options?.canPickMany) {
      const { selected } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'selected',
        message: options?.placeholder || 'Select options:',
        choices,
      }]);
      return selected.length > 0 ? selected : undefined;
    } else {
      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: options?.placeholder || 'Select an option:',
        choices: [...choices, { name: 'Cancel', value: null }],
      }]);
      return selected;
    }
  }

  async confirm(message: string, confirmLabel = 'Yes', _cancelLabel = 'No'): Promise<boolean> {
    const { confirmed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirmed',
      message,
      default: false,
    }]);
    return confirmed;
  }

  async withProgress<T>(
    options: ProgressOptions,
    task: (progress: ProgressReporter, token: CancellationToken) => Promise<T>
  ): Promise<T> {
    console.log(`⏳ ${options.title}`);

    const reporter: ProgressReporter = {
      report: ({ message }) => {
        if (message) console.log(`   ${message}`);
      },
    };

    const token: CancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: () => () => {},
    };

    const result = await task(reporter, token);
    console.log(`✅ Done`);
    return result;
  }
}
```

### 6. Wire Everything Together

```typescript
// packages/cli/src/index.ts
#!/usr/bin/env node
import { Command } from 'commander';
import * as path from 'path';
import {
  NodeSystemAdapter,
  EventBus,
  Logger,
  GitService,
  StatusService,
  TmuxService,
  WorktreeManager,
  AgentStatusTracker,
  AgentPersistence,
} from '@opus-orchestra/core';

import { FileStorageAdapter } from './adapters/FileStorageAdapter';
import { FileConfigAdapter } from './adapters/FileConfigAdapter';
import { TerminalUIAdapter } from './adapters/TerminalUIAdapter';

// Determine config/storage paths
const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
const configDir = path.join(homeDir, '.opus-orchestra');
const configPath = path.join(configDir, 'config.json');

// Create adapters
const system = new NodeSystemAdapter('bash');
const storage = new FileStorageAdapter(configDir);
const config = new FileConfigAdapter(configPath);
const ui = new TerminalUIAdapter();

// Create services
const logger = new Logger(configDir);
const eventBus = new EventBus(logger);
const gitService = new GitService(system, logger);
const statusService = new StatusService(system, logger);
const tmuxService = new TmuxService(system, config.get('tmuxSessionPrefix'), logger);

// Create managers
const worktreeManager = new WorktreeManager(system, config, logger);
const statusTracker = new AgentStatusTracker(
  statusService, gitService, eventBus, config, logger
);
const persistence = new AgentPersistence(worktreeManager, storage, logger);

// CLI commands
const program = new Command();

program
  .name('opus')
  .description('Opus Orchestra CLI')
  .version('0.1.0');

program
  .command('create')
  .description('Create new agents')
  .option('-n, --count <number>', 'Number of agents', '1')
  .option('-r, --repo <path>', 'Repository path')
  .action(async (options) => {
    const repoPath = options.repo || process.cwd();
    const count = parseInt(options.count, 10);

    // Create agents using core logic
    // ... implementation using managers
  });

program
  .command('list')
  .description('List agents')
  .action(async () => {
    // List agents using persistence
    const agents = persistence.loadPersistedAgents();
    for (const agent of agents) {
      console.log(`${agent.id}: ${agent.name} (${agent.branch})`);
    }
  });

program.parse();
```

## Key Points

### 1. Reuse SystemAdapter

Don't reimplement OS handling. Use `NodeSystemAdapter` from core:

```typescript
import { NodeSystemAdapter } from '@opus-orchestra/core';
const system = new NodeSystemAdapter('bash'); // or 'wsl', etc.
```

### 2. Focus on UI Adapters

Your new UI mainly needs to implement:
- **StorageAdapter** - How to persist data
- **ConfigAdapter** - How to read/write config
- **UIAdapter** - How to interact with users

### 3. Reuse Core Logic

All business logic stays in core. Your UI just:
1. Creates adapters
2. Wires them to core managers/services
3. Calls core methods
4. Displays results

### 4. Event-Driven Updates

Subscribe to EventBus for real-time updates:

```typescript
eventBus.on('agent:created', ({ agent }) => {
  console.log(`Created: ${agent.name}`);
});

eventBus.on('agent:statusChanged', ({ agent, previousStatus }) => {
  console.log(`${agent.name}: ${previousStatus} → ${agent.status}`);
});
```

## Example: Web Server

For a web server UI, you might implement:

```typescript
// Adapters
class DatabaseStorageAdapter implements StorageAdapter { /* ... */ }
class EnvConfigAdapter implements ConfigAdapter { /* ... */ }
class WebSocketUIAdapter implements UIAdapter { /* ... */ }

// Wire up with Express/Fastify
app.post('/api/agents', async (req, res) => {
  const { count, repoPath } = req.body;
  await agentManager.createAgents(count, repoPath);
  res.json({ success: true });
});

// Real-time updates via WebSocket
eventBus.on('agent:statusChanged', ({ agent }) => {
  wss.clients.forEach(client => {
    client.send(JSON.stringify({ type: 'statusChanged', agent }));
  });
});
```
