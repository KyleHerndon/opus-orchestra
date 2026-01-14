/**
 * SystemAdapter - Abstracts all OS-specific operations
 *
 * This interface centralizes ALL platform-specific logic.
 * No OS-specific code should exist outside of SystemAdapter implementations.
 *
 * Implementations:
 * - VSCodeSystemAdapter (packages/vscode) - Windows/WSL/macOS/Linux support
 * - MockSystemAdapter (tests) - For unit testing
 */

/**
 * Supported platforms
 */
export type Platform = 'win32' | 'darwin' | 'linux';

/**
 * Terminal/shell types
 */
export type TerminalType = 'bash' | 'wsl' | 'powershell' | 'cmd' | 'gitbash';

/**
 * Path context determines the format of returned paths
 * - nodeFs: For Node.js fs operations (forward slashes, Windows UNC paths for WSL native)
 * - terminal: For shell commands (WSL /mnt/c/, Git Bash /c/, etc.)
 * - display: For showing to users (native OS format)
 */
export type PathContext = 'nodeFs' | 'terminal' | 'display';

/**
 * File stat information
 */
export interface FileStat {
  mtimeMs: number;
  isDirectory(): boolean;
  isFile(): boolean;
}

/**
 * Spawned process interface (subset of ChildProcess)
 * Used for long-running processes like tmux control mode
 */
export interface SpawnedProcess {
  stdin: NodeJS.WritableStream | null;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
}

/**
 * SystemAdapter abstracts all OS-specific operations.
 * This is the single point of platform detection and path conversion.
 */
export interface SystemAdapter {
  // ========== Platform Detection ==========

  /**
   * Get the current platform.
   * Note: Core code should NOT use this directly for conditionals.
   * All platform-specific behavior should be encapsulated in adapter methods.
   */
  getPlatform(): Platform;

  /**
   * Get the configured terminal type.
   */
  getTerminalType(): TerminalType;

  /**
   * Check if running inside WSL (Linux under Windows).
   */
  isWsl(): boolean;

  /**
   * Get the default WSL distribution name.
   * Returns empty string if not applicable.
   */
  getWslDistro(): string;

  /**
   * Get a temporary directory path appropriate for the current environment.
   * On Unix: /tmp
   * On Windows with WSL terminal: /tmp (via WSL)
   * On Windows native: os.tmpdir()
   *
   * @returns Temp directory path (in nodeFs format for file operations)
   */
  getTempDirectory(): string;

  // ========== Path Operations ==========

  /**
   * Convert a path for a specific context.
   * Handles all path format conversions internally.
   *
   * @param inputPath - Path in any format
   * @param context - Target context for the path
   * @returns Path formatted for the specified context
   */
  convertPath(inputPath: string, context: PathContext): string;

  /**
   * Join path segments and return path for the nodeFs context.
   * Uses forward slashes, handles cross-platform correctly.
   *
   * @param basePath - Base path
   * @param segments - Path segments to append
   * @returns Joined path for Node.js fs operations
   */
  joinPath(basePath: string, ...segments: string[]): string;

  /**
   * Get the home directory appropriate for current environment.
   * For WSL terminal type, returns WSL home directory.
   * For native terminals, returns OS home directory.
   *
   * @returns Home directory path (in nodeFs format)
   */
  getHomeDirectory(): string;

  // ========== Command Execution ==========

  /**
   * Execute a shell command synchronously.
   * Automatically wraps command for correct shell (WSL, Git Bash, etc.).
   *
   * @param command - Command to execute
   * @param cwd - Working directory (will be converted to terminal format)
   * @returns Command output
   * @throws Error if command fails
   */
  execSync(command: string, cwd: string): string;

  /**
   * Execute a shell command asynchronously.
   * Automatically wraps command for correct shell.
   *
   * @param command - Command to execute
   * @param cwd - Working directory (will be converted to terminal format)
   * @returns Promise resolving to command output
   */
  exec(command: string, cwd: string): Promise<string>;

  /**
   * Execute a command silently, ignoring errors.
   * Useful for cleanup operations.
   *
   * @param command - Command to execute
   * @param cwd - Working directory
   */
  execSilent(command: string, cwd: string): void;

  /**
   * Spawn a long-running process (for tmux control mode, etc).
   * Automatically wraps command for correct shell (WSL, Git Bash, etc.).
   *
   * @param command - Command to spawn (e.g., 'tmux')
   * @param args - Command arguments
   * @returns An object with stdin, stdout, stderr streams, and kill/on methods
   */
  spawn(command: string, args: string[]): SpawnedProcess;

  // ========== File System ==========

  /**
   * Check if a path exists.
   * @param path - Path to check (will be converted to nodeFs format)
   */
  exists(path: string): boolean;

  /**
   * Read file contents as UTF-8 string.
   * @param path - File path (will be converted to nodeFs format)
   * @returns File contents
   * @throws Error if file doesn't exist or can't be read
   */
  readFile(path: string): string;

  /**
   * Write content to a file.
   * Creates parent directories if needed.
   * @param path - File path (will be converted to nodeFs format)
   * @param content - Content to write
   */
  writeFile(path: string, content: string): void;

  /**
   * Read directory contents.
   * @param path - Directory path (will be converted to nodeFs format)
   * @returns Array of entry names
   */
  readDir(path: string): string[];

  /**
   * Create a directory recursively.
   * @param path - Directory path (will be converted to nodeFs format)
   */
  mkdir(path: string): void;

  /**
   * Copy a file.
   * @param src - Source path
   * @param dest - Destination path
   */
  copyFile(src: string, dest: string): void;

  /**
   * Copy a directory recursively.
   * @param src - Source directory path
   * @param dest - Destination directory path
   */
  copyDirRecursive(src: string, dest: string): void;

  /**
   * Delete a file.
   * @param path - File path
   */
  unlink(path: string): void;

  /**
   * Delete a directory.
   * @param path - Directory path
   * @param options - Options (recursive: delete contents)
   */
  rmdir(path: string, options?: { recursive?: boolean }): void;

  /**
   * Create a symbolic link (or junction on Windows).
   * @param target - Link target
   * @param path - Link path
   */
  symlink(target: string, path: string): void;

  /**
   * Get file/directory stats.
   * @param path - Path to stat
   * @returns File stats
   */
  stat(path: string): FileStat;

  /**
   * Change file mode/permissions.
   * @param path - File path
   * @param mode - Mode (e.g., 0o755)
   */
  chmod(path: string, mode: number): void;

  /**
   * Get the modification time of a file.
   * @param path - File path
   * @returns Modification time in milliseconds
   */
  getMtime(path: string): number;

  // ========== Safe File Operations (Optional) ==========
  // These methods provide defensive alternatives that don't throw on ENOENT.
  // Implementations are optional for backwards compatibility.

  /**
   * Safe file read - returns null instead of throwing on ENOENT.
   * @param path - File path
   * @returns File contents or null if file doesn't exist
   */
  safeReadFile?(path: string): string | null;

  /**
   * Safe directory read - returns empty array on ENOENT.
   * @param path - Directory path
   * @returns Array of entry names, empty if dir doesn't exist
   */
  safeReadDir?(path: string): string[];

  /**
   * Safe stat - returns null instead of throwing on ENOENT.
   * @param path - Path to stat
   * @returns File stats or null if doesn't exist
   */
  safeStat?(path: string): FileStat | null;

  /**
   * Atomic write - writes to temp file, then renames.
   * Ensures partial writes don't corrupt data.
   * @param path - Target file path
   * @param content - Content to write
   */
  atomicWrite?(path: string, content: string): void;
}
