# SystemAdapter Design

## Purpose

SystemAdapter is the **single point of platform abstraction** in Opus Orchestra. It centralizes ALL OS-specific logic so that core code never needs to know about:

- Windows vs macOS vs Linux
- WSL path translation
- Shell differences (bash, PowerShell, cmd)
- File system encoding issues

## The Problem It Solves

Without SystemAdapter, platform code leaks everywhere:

```typescript
// BAD: Platform checks scattered throughout codebase
if (os.platform() === 'win32') {
  if (terminalType === 'wsl') {
    path = path.replace(/^([A-Z]):/, '/mnt/$1').toLowerCase();
  }
} else if (os.platform() === 'darwin') {
  // macOS handling
}
```

With SystemAdapter, core code is platform-agnostic:

```typescript
// GOOD: Core code doesn't know about platforms
const fsPath = system.convertPath(worktreePath, 'nodeFs');
const output = system.execSync('git status', worktreePath);
```

## Core Principle: No OS References Outside SystemAdapter

The core package must have **zero** references to:

| Forbidden | Why |
|-----------|-----|
| `os.platform()` | Platform detection belongs in adapter |
| `process.platform` | Same as above |
| `os.homedir()` | Home directory varies by platform/WSL |
| `'win32'`, `'darwin'`, `'linux'` | OS name strings |
| `'windows'`, `'wsl'`, `'macos'` | OS name strings |
| `/mnt/c/`, `/c/`, `C:\` | Platform-specific path formats |
| `\\wsl$\`, `\\wsl.localhost\` | WSL UNC paths |
| `powershell`, `cmd`, `bash` | Shell-specific code |

All of this lives **exclusively** in SystemAdapter implementations.

## Path Contexts

SystemAdapter converts paths for different contexts:

```typescript
type PathContext = 'nodeFs' | 'terminal' | 'display';
```

### `nodeFs` - For Node.js File Operations

Used with `fs.readFileSync()`, `fs.existsSync()`, etc.

| Input | Output (Windows + WSL) |
|-------|------------------------|
| `/mnt/c/Users/Kyle/project` | `C:/Users/Kyle/project` |
| `C:\Users\Kyle\project` | `C:/Users/Kyle/project` |
| `/home/kyle/.claude` | `//wsl.localhost/Ubuntu/home/kyle/.claude` |

### `terminal` - For Shell Commands

Used when executing commands in terminals.

| Input | Output (WSL terminal) |
|-------|----------------------|
| `C:/Users/Kyle/project` | `/mnt/c/Users/Kyle/project` |
| `C:\Users\Kyle\project` | `/mnt/c/Users/Kyle/project` |
| `/home/kyle/.claude` | `/home/kyle/.claude` |

### `display` - For User Display

Native format for the current OS.

| Input | Output (Windows) |
|-------|-----------------|
| `/mnt/c/Users/Kyle/project` | `C:\Users\Kyle\project` |

## Interface

```typescript
interface SystemAdapter {
  // Platform detection (use sparingly in adapters only)
  getPlatform(): 'win32' | 'darwin' | 'linux';
  getTerminalType(): 'bash' | 'wsl' | 'powershell' | 'cmd' | 'gitbash';
  isWsl(): boolean;
  getWslDistro(): string;

  // Path operations
  convertPath(path: string, context: PathContext): string;
  joinPath(base: string, ...segments: string[]): string;
  getHomeDirectory(): string;

  // Command execution
  execSync(command: string, cwd: string): string;
  exec(command: string, cwd: string): Promise<string>;
  execSilent(command: string, cwd: string): void;

  // File system
  exists(path: string): boolean;
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  readDir(path: string): string[];
  mkdir(path: string): void;
  copyFile(src: string, dest: string): void;
  unlink(path: string): void;
  rmdir(path: string, options?: { recursive?: boolean }): void;
  stat(path: string): FileStat;
  chmod(path: string, mode: number): void;
  getMtime(path: string): number;
  symlink(target: string, path: string): void;
}
```

## Implementations

### NodeSystemAdapter (Core)

The primary implementation using Node.js APIs. Lives in core because it only uses Node.js (not VS Code).

```typescript
// packages/core/src/adapters/NodeSystemAdapter.ts
export class NodeSystemAdapter implements SystemAdapter {
  constructor(terminalType: TerminalType) {
    this.terminalType = terminalType;
  }

  convertPath(inputPath: string, context: PathContext): string {
    const parsed = this.parsePath(inputPath);
    switch (context) {
      case 'nodeFs': return this.toNodeFsPath(parsed);
      case 'terminal': return this.toTerminalPath(parsed);
      case 'display': return this.toDisplayPath(parsed);
    }
  }
  // ...
}
```

### MockSystemAdapter (Tests)

In-memory implementation for unit testing.

```typescript
// packages/core/src/__tests__/mocks/MockSystemAdapter.ts
export class MockSystemAdapter implements SystemAdapter {
  private files = new Map<string, string>();
  private directories = new Set<string>();

  // Simulate file system in memory
  writeFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  readFile(path: string): string {
    const content = this.files.get(path);
    if (!content) throw new Error(`ENOENT: ${path}`);
    return content;
  }
  // ...
}
```

## Usage Examples

### In Services

```typescript
export class GitService {
  constructor(private system: SystemAdapter) {}

  isGitRepo(path: string): boolean {
    try {
      this.system.execSync('git rev-parse --git-dir', path);
      return true;
    } catch {
      return false;
    }
  }
}
```

### In Managers

```typescript
export class WorktreeManager {
  constructor(
    private system: SystemAdapter,
    private config: ConfigAdapter
  ) {}

  worktreeExists(worktreePath: string): boolean {
    const fsPath = this.system.convertPath(worktreePath, 'nodeFs');
    return this.system.exists(fsPath);
  }
}
```

### In Tests

```typescript
describe('GitService', () => {
  let system: MockSystemAdapter;
  let git: GitService;

  beforeEach(() => {
    system = new MockSystemAdapter();
    git = new GitService(system);
  });

  it('detects git repos', () => {
    system.setExecResult('git rev-parse --git-dir', '.git');
    expect(git.isGitRepo('/test')).toBe(true);
  });
});
```

## Why Not Multiple Platform Adapters?

You might wonder: why not `WindowsSystemAdapter`, `MacOSSystemAdapter`, etc.?

**Answer**: The `NodeSystemAdapter` handles all platforms internally. The complexity is:

1. **Path parsing** - Detecting what format a path is in
2. **Path conversion** - Converting to the target format
3. **Command wrapping** - Wrapping commands for WSL/Git Bash when needed

These are all interrelated. A single adapter that understands all formats can convert between any of them. Separate adapters would need to understand each other's formats anyway.

The terminal type (not platform) determines behavior:
- `wsl` → Commands run in WSL, paths need `/mnt/c/` format
- `bash` → Native bash, paths stay as-is
- `gitbash` → Git Bash on Windows, paths need `/c/` format
- `powershell`/`cmd` → Native Windows, paths need `C:\` format
