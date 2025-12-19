/**
 * MockSystemAdapter - Mock implementation for testing
 *
 * Provides an in-memory file system and configurable behavior
 * for unit testing without real OS operations.
 */

import {
  SystemAdapter,
  Platform,
  TerminalType,
  PathContext,
  FileStat,
} from '../../adapters/SystemAdapter';

/**
 * Mock file system entry
 */
interface MockFsEntry {
  type: 'file' | 'directory';
  content?: string;
  mtimeMs: number;
  mode: number;
}

/**
 * Mock SystemAdapter for testing
 */
export class MockSystemAdapter implements SystemAdapter {
  private platform: Platform = 'linux';
  private terminalType: TerminalType = 'bash';
  private wslDistro: string = '';
  private homeDir: string = '/home/test';
  private fs: Map<string, MockFsEntry> = new Map();
  private execResults: Map<string, string> = new Map();
  private execErrors: Map<string, Error> = new Map();

  // ========== Test Configuration ==========

  setPlatform(platform: Platform): void {
    this.platform = platform;
  }

  setTerminalType(type: TerminalType): void {
    this.terminalType = type;
  }

  setWslDistro(distro: string): void {
    this.wslDistro = distro;
  }

  setHomeDirectory(home: string): void {
    this.homeDir = home;
  }

  /**
   * Set the result for a command
   */
  setExecResult(command: string, result: string): void {
    this.execResults.set(command, result);
    this.execErrors.delete(command);
  }

  /**
   * Set an error for a command
   */
  setExecError(command: string, error: Error): void {
    this.execErrors.set(command, error);
    this.execResults.delete(command);
  }

  /**
   * Add a file to the mock filesystem
   */
  addFile(path: string, content: string): void {
    this.fs.set(this.normalizePath(path), {
      type: 'file',
      content,
      mtimeMs: Date.now(),
      mode: 0o644,
    });
  }

  /**
   * Add a directory to the mock filesystem
   */
  addDirectory(path: string): void {
    this.fs.set(this.normalizePath(path), {
      type: 'directory',
      mtimeMs: Date.now(),
      mode: 0o755,
    });
  }

  /**
   * Clear the mock filesystem
   */
  clearFs(): void {
    this.fs.clear();
  }

  /**
   * Get all files in the mock filesystem
   */
  getFs(): Map<string, MockFsEntry> {
    return new Map(this.fs);
  }

  private normalizePath(path: string): string {
    // Simple normalization - remove trailing slashes and normalize separators
    return path.replace(/\\/g, '/').replace(/\/+$/, '');
  }

  // ========== SystemAdapter Implementation ==========

  getPlatform(): Platform {
    return this.platform;
  }

  getTerminalType(): TerminalType {
    return this.terminalType;
  }

  isWsl(): boolean {
    return this.platform === 'linux' && this.wslDistro !== '';
  }

  getWslDistro(): string {
    return this.wslDistro;
  }

  convertPath(inputPath: string, context: PathContext): string {
    // Simple pass-through for tests - paths stay as-is
    const normalized = this.normalizePath(inputPath);

    switch (context) {
      case 'nodeFs':
        return normalized;
      case 'terminal':
        return normalized;
      case 'display':
        return normalized;
      default:
        return normalized;
    }
  }

  joinPath(basePath: string, ...segments: string[]): string {
    const parts = [this.normalizePath(basePath), ...segments.map(s => s.replace(/^\/+/, ''))];
    return parts.join('/').replace(/\/+/g, '/');
  }

  getHomeDirectory(): string {
    return this.homeDir;
  }

  execSync(command: string, _cwd: string): string {
    // Check for exact match first
    if (this.execErrors.has(command)) {
      throw this.execErrors.get(command)!;
    }
    if (this.execResults.has(command)) {
      return this.execResults.get(command)!;
    }

    // Check for partial match (command starts with)
    for (const [cmd, result] of this.execResults) {
      if (command.startsWith(cmd)) {
        return result;
      }
    }
    for (const [cmd, error] of this.execErrors) {
      if (command.startsWith(cmd)) {
        throw error;
      }
    }

    // Default: return empty string
    return '';
  }

  exec(command: string, cwd: string): Promise<string> {
    try {
      return Promise.resolve(this.execSync(command, cwd));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  execSilent(_command: string, _cwd: string): void {
    // No-op for tests
  }

  exists(path: string): boolean {
    return this.fs.has(this.normalizePath(path));
  }

  readFile(path: string): string {
    const entry = this.fs.get(this.normalizePath(path));
    if (!entry || entry.type !== 'file') {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return entry.content || '';
  }

  writeFile(path: string, content: string): void {
    const normalized = this.normalizePath(path);
    this.fs.set(normalized, {
      type: 'file',
      content,
      mtimeMs: Date.now(),
      mode: 0o644,
    });
  }

  readDir(path: string): string[] {
    const normalized = this.normalizePath(path);
    const entries: string[] = [];

    for (const [fsPath] of this.fs) {
      if (fsPath.startsWith(normalized + '/')) {
        const relativePath = fsPath.slice(normalized.length + 1);
        const firstPart = relativePath.split('/')[0];
        if (firstPart && !entries.includes(firstPart)) {
          entries.push(firstPart);
        }
      }
    }

    return entries;
  }

  mkdir(path: string): void {
    const normalized = this.normalizePath(path);
    this.fs.set(normalized, {
      type: 'directory',
      mtimeMs: Date.now(),
      mode: 0o755,
    });
  }

  copyFile(src: string, dest: string): void {
    const content = this.readFile(src);
    this.writeFile(dest, content);
  }

  copyDirRecursive(src: string, dest: string): void {
    const srcNorm = this.normalizePath(src);
    const destNorm = this.normalizePath(dest);

    for (const [path, entry] of this.fs) {
      if (path.startsWith(srcNorm + '/') || path === srcNorm) {
        const newPath = path.replace(srcNorm, destNorm);
        this.fs.set(newPath, { ...entry, mtimeMs: Date.now() });
      }
    }
  }

  unlink(path: string): void {
    const normalized = this.normalizePath(path);
    if (!this.fs.has(normalized)) {
      throw new Error(`ENOENT: no such file or directory, unlink '${path}'`);
    }
    this.fs.delete(normalized);
  }

  rmdir(path: string, options?: { recursive?: boolean }): void {
    const normalized = this.normalizePath(path);

    if (options?.recursive) {
      // Delete all entries under this path
      for (const [fsPath] of this.fs) {
        if (fsPath === normalized || fsPath.startsWith(normalized + '/')) {
          this.fs.delete(fsPath);
        }
      }
    } else {
      this.fs.delete(normalized);
    }
  }

  symlink(_target: string, path: string): void {
    // For testing, just create an empty file
    this.writeFile(path, '');
  }

  stat(path: string): FileStat {
    const entry = this.fs.get(this.normalizePath(path));
    if (!entry) {
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    }
    return {
      mtimeMs: entry.mtimeMs,
      isDirectory: () => entry.type === 'directory',
      isFile: () => entry.type === 'file',
    };
  }

  chmod(path: string, mode: number): void {
    const entry = this.fs.get(this.normalizePath(path));
    if (entry) {
      entry.mode = mode;
    }
  }

  getMtime(path: string): number {
    return this.stat(path).mtimeMs;
  }
}
