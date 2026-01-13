/**
 * NodeSystemAdapter - Node.js implementation of SystemAdapter
 *
 * Handles all OS-specific operations for Windows, WSL, macOS, and Linux.
 * Uses only Node.js APIs - no VS Code dependencies.
 *
 * The terminal type must be provided at construction time (injected from config).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync, exec } from 'child_process';
import {
  SystemAdapter,
  Platform,
  TerminalType,
  PathContext,
  FileStat,
} from './SystemAdapter';

/**
 * Common paths for Git Bash on Windows (checked in order)
 */
const GIT_BASH_PATHS = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  process.env.GIT_BASH_PATH || '', // Allow override via environment variable
].filter(Boolean);

/**
 * Parse a path to extract drive letter and path components
 */
interface ParsedPath {
  drive: string;
  restPath: string;
  isWslNative: boolean;
  wslDistro: string;
}

/**
 * Parse any path format into normalized components
 */
function parsePath(inputPath: string, defaultWslDistro: string): ParsedPath {
  // Match patterns
  const wslMountMatch = inputPath.match(/^\/mnt\/([a-z])\/(.*)/i);
  const gitBashMatch = inputPath.match(/^\/([a-z])\/(.*)/i);
  const windowsMatch = inputPath.match(/^([a-zA-Z]):[\\/](.*)/);
  const wslUncBackslashMatch = inputPath.match(/^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\(.*)/i);
  const wslUncForwardMatch = inputPath.match(/^\/\/wsl(?:\.localhost|\$)\/([^/]+)\/(.*)/i);

  if (wslUncBackslashMatch) {
    // UNC path with backslashes: \\wsl.localhost\Ubuntu\home\user
    return {
      drive: '',
      wslDistro: wslUncBackslashMatch[1],
      restPath: '/' + wslUncBackslashMatch[2].replace(/\\/g, '/'),
      isWslNative: true,
    };
  }

  if (wslUncForwardMatch) {
    // UNC path with forward slashes: //wsl.localhost/Ubuntu/home/user
    return {
      drive: '',
      wslDistro: wslUncForwardMatch[1],
      restPath: '/' + wslUncForwardMatch[2],
      isWslNative: true,
    };
  }

  if (wslMountMatch) {
    // WSL mounted Windows drive: /mnt/c/Users/...
    return {
      drive: wslMountMatch[1].toLowerCase(),
      restPath: wslMountMatch[2].replace(/\\/g, '/'),
      isWslNative: false,
      wslDistro: '',
    };
  }

  if (windowsMatch) {
    // Windows path: C:\Users\... or C:/Users/...
    return {
      drive: windowsMatch[1].toLowerCase(),
      restPath: windowsMatch[2].replace(/\\/g, '/'),
      isWslNative: false,
      wslDistro: '',
    };
  }

  if (gitBashMatch && !inputPath.startsWith('/mnt/') && gitBashMatch[1].length === 1) {
    // Git Bash path: /c/Users/...
    return {
      drive: gitBashMatch[1].toLowerCase(),
      restPath: gitBashMatch[2].replace(/\\/g, '/'),
      isWslNative: false,
      wslDistro: '',
    };
  }

  if (inputPath.startsWith('/') && !inputPath.startsWith('/mnt/')) {
    // WSL native path: /home/user/... (not a mounted drive)
    return {
      drive: '',
      restPath: inputPath,
      isWslNative: true,
      wslDistro: defaultWslDistro,
    };
  }

  // Unknown format - assume it's a relative path
  return {
    drive: '',
    restPath: inputPath.replace(/\\/g, '/'),
    isWslNative: false,
    wslDistro: '',
  };
}

/**
 * Node.js implementation of SystemAdapter
 */
export class NodeSystemAdapter implements SystemAdapter {
  private terminalType: TerminalType;
  private cachedWslDistro: string | null = null;
  private cachedWslHome: string | null = null;
  private cachedGitBashPath: string | null = null;

  constructor(terminalType: TerminalType) {
    this.terminalType = terminalType;
  }

  /**
   * Get the Git Bash executable path.
   * Tries common locations and caches the result.
   * Returns empty string if not found.
   */
  private getGitBashPath(): string {
    if (this.cachedGitBashPath !== null) {
      return this.cachedGitBashPath;
    }

    // Try common paths first (faster than spawning processes)
    for (const bashPath of GIT_BASH_PATHS) {
      if (fs.existsSync(bashPath)) {
        this.cachedGitBashPath = bashPath;
        return bashPath;
      }
    }

    // Try to find bash.exe using 'where' command on Windows
    try {
      const result = execSync('where bash.exe 2>nul', { encoding: 'utf-8', timeout: 5000 });
      const lines = result.trim().split('\n');
      // Prefer Git Bash over WSL bash
      const gitBash = lines.find(line => line.toLowerCase().includes('git'));
      if (gitBash) {
        this.cachedGitBashPath = gitBash.trim();
        return this.cachedGitBashPath;
      }
      if (lines.length > 0) {
        this.cachedGitBashPath = lines[0].trim();
        return this.cachedGitBashPath;
      }
    } catch {
      // 'where' command failed - Git Bash may not be installed
    }

    // Not found - cache empty string to avoid repeated lookups
    this.cachedGitBashPath = '';
    return '';
  }

  // ========== Platform Detection ==========

  getPlatform(): Platform {
    return os.platform() as Platform;
  }

  getTerminalType(): TerminalType {
    return this.terminalType;
  }

  /**
   * Update the terminal type (e.g., when config changes)
   */
  setTerminalType(type: TerminalType): void {
    this.terminalType = type;
  }

  isWsl(): boolean {
    if (this.getPlatform() !== 'linux') {
      return false;
    }
    try {
      const version = fs.readFileSync('/proc/version', 'utf8');
      return version.toLowerCase().includes('microsoft');
    } catch {
      return false;
    }
  }

  getWslDistro(): string {
    if (this.cachedWslDistro !== null) {
      return this.cachedWslDistro;
    }

    if (this.getPlatform() !== 'win32') {
      this.cachedWslDistro = '';
      return '';
    }

    try {
      const result = execSync('wsl.exe -l -q', {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
      });
      const lines = result.replace(/\0/g, '').trim().split('\n');
      this.cachedWslDistro = lines[0]?.trim() || '';
    } catch {
      this.cachedWslDistro = '';
    }

    return this.cachedWslDistro;
  }

  // ========== Path Operations ==========

  convertPath(inputPath: string, context: PathContext): string {
    const parsed = parsePath(inputPath, this.getWslDistro());

    switch (context) {
      case 'nodeFs':
        return this.toNodeFsPath(parsed);
      case 'terminal':
        return this.toTerminalPath(parsed);
      case 'display':
        return this.toDisplayPath(parsed);
      default:
        return inputPath;
    }
  }

  private toNodeFsPath(parsed: ParsedPath): string {
    const platform = this.getPlatform();

    // On Linux (including WSL VS Code), use Linux paths
    if (platform !== 'win32') {
      if (parsed.isWslNative) {
        return parsed.restPath;
      } else if (parsed.drive) {
        return `/mnt/${parsed.drive}/${parsed.restPath}`;
      } else {
        return parsed.restPath;
      }
    }

    // On Windows
    if (parsed.isWslNative && parsed.wslDistro) {
      // Convert WSL native path to UNC path for Windows Node.js
      return `\\\\wsl.localhost\\${parsed.wslDistro}${parsed.restPath.replace(/\//g, '\\')}`;
    } else if (!parsed.drive) {
      return parsed.restPath;
    } else {
      return `${parsed.drive.toUpperCase()}:/${parsed.restPath}`;
    }
  }

  private toTerminalPath(parsed: ParsedPath): string {
    // WSL native paths stay as-is for WSL/bash terminals
    if (parsed.isWslNative) {
      if (this.terminalType === 'wsl' || this.terminalType === 'bash') {
        return parsed.restPath;
      } else if (parsed.wslDistro) {
        // For Windows terminals, use UNC path
        return `\\\\wsl.localhost\\${parsed.wslDistro}${parsed.restPath.replace(/\//g, '\\')}`;
      } else {
        return parsed.restPath;
      }
    }

    // Unix path without drive letter
    if (!parsed.drive) {
      return parsed.restPath.startsWith('/') ? parsed.restPath : `/${parsed.restPath}`;
    }

    // Path with drive letter - format based on terminal type
    switch (this.terminalType) {
      case 'wsl':
        return `/mnt/${parsed.drive}/${parsed.restPath}`;
      case 'gitbash':
        return `/${parsed.drive}/${parsed.restPath}`;
      case 'bash':
        // Native bash with Windows drive - likely WSL accessing Windows files
        if (parsed.drive) {
          return `/mnt/${parsed.drive}/${parsed.restPath}`;
        }
        return parsed.restPath.startsWith('/') ? parsed.restPath : `/${parsed.restPath}`;
      case 'powershell':
      case 'cmd':
        return `${parsed.drive.toUpperCase()}:\\${parsed.restPath.replace(/\//g, '\\')}`;
      default:
        return this.toNodeFsPath(parsed);
    }
  }

  private toDisplayPath(parsed: ParsedPath): string {
    if (!parsed.drive) {
      return parsed.restPath;
    }
    return `${parsed.drive.toUpperCase()}:\\${parsed.restPath.replace(/\//g, '\\')}`;
  }

  joinPath(basePath: string, ...segments: string[]): string {
    const nodeBase = this.convertPath(basePath, 'nodeFs');
    // For UNC paths use backslash, otherwise forward slash
    const sep = nodeBase.startsWith('\\\\') ? '\\' : '/';
    let joined = [nodeBase, ...segments].join(sep);

    // Normalize separators
    if (joined.startsWith('\\\\')) {
      joined = '\\\\' + joined.slice(2).replace(/[\\/]+/g, '\\');
    } else if (joined.startsWith('//')) {
      joined = '//' + joined.slice(2).replace(/\/+/g, '/');
    } else {
      joined = joined.replace(/\/+/g, '/');
    }

    return joined;
  }

  getHomeDirectory(): string {
    const platform = this.getPlatform();

    // On Linux, use native home
    if (platform !== 'win32') {
      return os.homedir();
    }

    // On Windows with WSL terminal, get WSL home
    if (this.terminalType === 'wsl') {
      if (this.cachedWslHome !== null) {
        return this.cachedWslHome;
      }

      const distro = this.getWslDistro();
      if (distro) {
        try {
          const result = execSync('wsl.exe -e sh -c "echo $HOME"', {
            encoding: 'utf-8',
            timeout: 5000,
            windowsHide: true,
          });
          const wslHome = result.trim();
          if (wslHome) {
            // Return as UNC path for Windows Node.js fs operations
            this.cachedWslHome = `\\\\wsl.localhost\\${distro}${wslHome.replace(/\//g, '\\')}`;
            return this.cachedWslHome;
          }
        } catch {
          // Fall through to Windows home
        }
      }
    }

    return os.homedir();
  }

  // ========== Command Execution ==========

  execSync(command: string, cwd: string): string {
    const terminalPath = this.convertPath(cwd, 'terminal');
    const platform = this.getPlatform();

    // On Linux, execute directly
    if (platform !== 'win32') {
      return execSync(command, { cwd: terminalPath, encoding: 'utf-8', shell: '/bin/bash' });
    }

    // On Windows, use configured terminal type
    switch (this.terminalType) {
      case 'wsl': {
        const escapedCmd = command.replace(/'/g, "'\\''");
        return execSync(`wsl bash -c "cd '${terminalPath}' && ${escapedCmd}"`, { encoding: 'utf-8' });
      }
      case 'gitbash': {
        const gitBashPath = this.getGitBashPath();
        if (!gitBashPath) {
          throw new Error('Git Bash not found. Set GIT_BASH_PATH environment variable or install Git for Windows.');
        }
        const escapedCmd = command.replace(/'/g, "'\\''");
        return execSync(`"${gitBashPath}" -c "cd '${terminalPath}' && ${escapedCmd}"`, { encoding: 'utf-8' });
      }
      case 'bash':
        return execSync(command, { cwd: terminalPath, encoding: 'utf-8', shell: '/bin/bash' });
      case 'powershell':
      case 'cmd':
      default:
        return execSync(command, { cwd: terminalPath, encoding: 'utf-8' });
    }
  }

  exec(command: string, cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const terminalPath = this.convertPath(cwd, 'terminal');
      const platform = this.getPlatform();

      let fullCommand: string;
      const execOptions: { cwd?: string; encoding: 'utf-8'; shell?: string } = { encoding: 'utf-8' };

      if (platform !== 'win32') {
        fullCommand = command;
        execOptions.cwd = terminalPath;
        execOptions.shell = '/bin/bash';
      } else {
        switch (this.terminalType) {
          case 'wsl': {
            const escapedCmd = command.replace(/'/g, "'\\''");
            fullCommand = `wsl bash -c "cd '${terminalPath}' && ${escapedCmd}"`;
            break;
          }
          case 'gitbash': {
            const gitBashPath = this.getGitBashPath();
            if (!gitBashPath) {
              reject(new Error('Git Bash not found. Set GIT_BASH_PATH environment variable or install Git for Windows.'));
              return;
            }
            const escapedCmd = command.replace(/'/g, "'\\''");
            fullCommand = `"${gitBashPath}" -c "cd '${terminalPath}' && ${escapedCmd}"`;
            break;
          }
          case 'bash':
            fullCommand = command;
            execOptions.cwd = terminalPath;
            execOptions.shell = '/bin/bash';
            break;
          case 'powershell':
          case 'cmd':
          default:
            fullCommand = command;
            execOptions.cwd = terminalPath;
            break;
        }
      }

      exec(fullCommand, execOptions, (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  execSilent(command: string, cwd: string): void {
    try {
      const terminalPath = this.convertPath(cwd, 'terminal');
      const platform = this.getPlatform();

      if (platform !== 'win32') {
        execSync(command, { cwd: terminalPath, stdio: 'ignore', shell: '/bin/bash' });
        return;
      }

      switch (this.terminalType) {
        case 'wsl': {
          const escapedCmd = command.replace(/'/g, "'\\''");
          execSync(`wsl bash -c "cd '${terminalPath}' && ${escapedCmd}"`, { stdio: 'ignore' });
          break;
        }
        case 'gitbash': {
          const gitBashPath = this.getGitBashPath();
          if (!gitBashPath) {
            // Silent exec - just return without throwing
            return;
          }
          const escapedCmd = command.replace(/'/g, "'\\''");
          execSync(`"${gitBashPath}" -c "cd '${terminalPath}' && ${escapedCmd}"`, { stdio: 'ignore' });
          break;
        }
        case 'bash':
          execSync(command, { cwd: terminalPath, stdio: 'ignore', shell: '/bin/bash' });
          break;
        case 'powershell':
        case 'cmd':
        default:
          execSync(command, { cwd: terminalPath, stdio: 'ignore' });
          break;
      }
    } catch {
      // Silently ignore errors
    }
  }

  // ========== File System ==========

  exists(inputPath: string): boolean {
    const nodePath = this.convertPath(inputPath, 'nodeFs');
    return fs.existsSync(nodePath);
  }

  readFile(inputPath: string): string {
    const nodePath = this.convertPath(inputPath, 'nodeFs');
    return fs.readFileSync(nodePath, 'utf-8');
  }

  writeFile(inputPath: string, content: string): void {
    const nodePath = this.convertPath(inputPath, 'nodeFs');
    const dir = path.dirname(nodePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(nodePath, content, 'utf-8');
  }

  readDir(inputPath: string): string[] {
    const nodePath = this.convertPath(inputPath, 'nodeFs');
    return fs.readdirSync(nodePath);
  }

  mkdir(inputPath: string): void {
    const nodePath = this.convertPath(inputPath, 'nodeFs');
    fs.mkdirSync(nodePath, { recursive: true });
  }

  copyFile(src: string, dest: string): void {
    const srcPath = this.convertPath(src, 'nodeFs');
    const destPath = this.convertPath(dest, 'nodeFs');
    fs.copyFileSync(srcPath, destPath);
  }

  copyDirRecursive(src: string, dest: string): void {
    const srcPath = this.convertPath(src, 'nodeFs');
    const destPath = this.convertPath(dest, 'nodeFs');
    fs.cpSync(srcPath, destPath, { recursive: true });
  }

  unlink(inputPath: string): void {
    const nodePath = this.convertPath(inputPath, 'nodeFs');
    fs.unlinkSync(nodePath);
  }

  rmdir(inputPath: string, options?: { recursive?: boolean }): void {
    const nodePath = this.convertPath(inputPath, 'nodeFs');
    if (options?.recursive) {
      fs.rmSync(nodePath, { recursive: true, force: true });
    } else {
      fs.rmdirSync(nodePath);
    }
  }

  symlink(target: string, linkPath: string): void {
    const targetPath = this.convertPath(target, 'nodeFs');
    const linkNodePath = this.convertPath(linkPath, 'nodeFs');

    // On Windows, use junction for directories
    if (this.getPlatform() === 'win32') {
      try {
        const stats = fs.statSync(targetPath);
        if (stats.isDirectory()) {
          fs.symlinkSync(targetPath, linkNodePath, 'junction');
          return;
        }
      } catch {
        // Target doesn't exist, create as file symlink
      }
    }

    fs.symlinkSync(targetPath, linkNodePath);
  }

  stat(inputPath: string): FileStat {
    const nodePath = this.convertPath(inputPath, 'nodeFs');
    const stats = fs.statSync(nodePath);
    return {
      mtimeMs: stats.mtimeMs,
      isDirectory: () => stats.isDirectory(),
      isFile: () => stats.isFile(),
    };
  }

  chmod(inputPath: string, mode: number): void {
    const nodePath = this.convertPath(inputPath, 'nodeFs');
    fs.chmodSync(nodePath, mode);
  }

  getMtime(inputPath: string): number {
    const nodePath = this.convertPath(inputPath, 'nodeFs');
    return fs.statSync(nodePath).mtimeMs;
  }

  // ========== Safe File Operations ==========

  /**
   * Safe file read - returns null if file doesn't exist.
   * Re-throws non-ENOENT errors.
   */
  safeReadFile(inputPath: string): string | null {
    const nodePath = this.convertPath(inputPath, 'nodeFs');
    try {
      return fs.readFileSync(nodePath, 'utf-8');
    } catch (error: unknown) {
      if (this.isEnoentError(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Safe directory read - returns empty array if dir doesn't exist.
   * Re-throws non-ENOENT errors.
   */
  safeReadDir(inputPath: string): string[] {
    const nodePath = this.convertPath(inputPath, 'nodeFs');
    try {
      return fs.readdirSync(nodePath);
    } catch (error: unknown) {
      if (this.isEnoentError(error)) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Safe stat - returns null if path doesn't exist.
   * Re-throws non-ENOENT errors.
   */
  safeStat(inputPath: string): FileStat | null {
    const nodePath = this.convertPath(inputPath, 'nodeFs');
    try {
      const stats = fs.statSync(nodePath);
      return {
        mtimeMs: stats.mtimeMs,
        isDirectory: () => stats.isDirectory(),
        isFile: () => stats.isFile(),
      };
    } catch (error: unknown) {
      if (this.isEnoentError(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Atomic write - writes to temp file, then renames.
   * Ensures partial writes don't corrupt data.
   */
  atomicWrite(inputPath: string, content: string): void {
    const nodePath = this.convertPath(inputPath, 'nodeFs');
    const dir = path.dirname(nodePath);

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write to temp file with unique suffix
    const tempPath = `${nodePath}.tmp.${process.pid}.${Date.now()}`;

    try {
      fs.writeFileSync(tempPath, content, 'utf-8');
      fs.renameSync(tempPath, nodePath);
    } catch (error) {
      // Clean up temp file on failure
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Check if error is ENOENT (file not found)
   */
  private isEnoentError(error: unknown): boolean {
    return (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code: string }).code === 'ENOENT'
    );
  }
}
