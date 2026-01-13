/**
 * Safe file system operations
 *
 * Defensive wrappers that never throw on ENOENT.
 * For use when file/directory may not exist.
 */

import type { SystemAdapter, FileStat } from '../adapters/SystemAdapter';

/**
 * Safe file read - returns null if file doesn't exist
 * Useful when checking for optional files
 *
 * @param system - SystemAdapter instance
 * @param path - File path to read
 * @returns File contents or null if file doesn't exist
 * @throws Re-throws non-ENOENT errors (permissions, etc.)
 */
export function safeReadFile(system: SystemAdapter, path: string): string | null {
  try {
    return system.readFile(path);
  } catch (error: unknown) {
    if (isEnoentError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Safe directory read - returns empty array if dir doesn't exist
 *
 * @param system - SystemAdapter instance
 * @param path - Directory path to read
 * @returns Array of entry names, empty if directory doesn't exist
 * @throws Re-throws non-ENOENT errors
 */
export function safeReadDir(system: SystemAdapter, path: string): string[] {
  try {
    return system.readDir(path);
  } catch (error: unknown) {
    if (isEnoentError(error)) {
      return [];
    }
    throw error;
  }
}

/**
 * Safe stat - returns null if path doesn't exist
 *
 * @param system - SystemAdapter instance
 * @param path - Path to stat
 * @returns File stats or null if path doesn't exist
 * @throws Re-throws non-ENOENT errors
 */
export function safeStat(system: SystemAdapter, path: string): FileStat | null {
  try {
    return system.stat(path);
  } catch (error: unknown) {
    if (isEnoentError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Safe file exists check - never throws
 *
 * @param system - SystemAdapter instance
 * @param path - Path to check
 * @returns true if path exists, false otherwise (including on errors)
 */
export function safeFileExists(system: SystemAdapter, path: string): boolean {
  try {
    return system.exists(path);
  } catch {
    return false;
  }
}

/**
 * Safe get modification time - returns null if file doesn't exist
 *
 * @param system - SystemAdapter instance
 * @param path - File path
 * @returns Modification time in ms, or null if file doesn't exist
 * @throws Re-throws non-ENOENT errors
 */
export function safeGetMtime(system: SystemAdapter, path: string): number | null {
  try {
    return system.getMtime(path);
  } catch (error: unknown) {
    if (isEnoentError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Atomic write - writes to temp file then renames
 * Prevents partial writes from corrupting data
 *
 * Uses the system adapter's atomicWrite method if available,
 * otherwise falls back to regular writeFile.
 *
 * @param system - SystemAdapter instance
 * @param path - Target file path
 * @param content - Content to write
 */
export function atomicWriteFile(
  system: SystemAdapter,
  path: string,
  content: string
): void {
  // Use adapter's atomic write if available (preferred - uses fs.renameSync)
  if (system.atomicWrite) {
    system.atomicWrite(path, content);
    return;
  }

  // Fallback to regular write (not atomic, but still works)
  system.writeFile(path, content);
}

/**
 * Atomic write with backup - keeps .bak file of previous version
 *
 * @param system - SystemAdapter instance
 * @param path - Target file path
 * @param content - Content to write
 */
export function atomicWriteFileWithBackup(
  system: SystemAdapter,
  path: string,
  content: string
): void {
  const backupPath = `${path}.bak`;

  // Backup existing file if it exists
  if (system.exists(path)) {
    try {
      system.copyFile(path, backupPath);
    } catch {
      // Continue even if backup fails
    }
  }

  atomicWriteFile(system, path, content);
}

/**
 * Read JSON file safely - returns null on error
 *
 * @param system - SystemAdapter instance
 * @param path - JSON file path
 * @returns Parsed JSON or null if file doesn't exist or is invalid
 */
export function safeReadJson<T>(system: SystemAdapter, path: string): T | null {
  const content = safeReadFile(system, path);
  if (content === null) {
    return null;
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Write JSON file atomically
 *
 * @param system - SystemAdapter instance
 * @param path - Target file path
 * @param data - Data to serialize as JSON
 * @param pretty - Use pretty printing (default: true)
 */
export function atomicWriteJson(
  system: SystemAdapter,
  path: string,
  data: unknown,
  pretty = true
): void {
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  atomicWriteFile(system, path, content);
}

/**
 * Read JSON file safely with validation
 *
 * @param system - SystemAdapter instance
 * @param path - JSON file path
 * @param validate - Validation function
 * @returns Validated data or null if invalid
 */
export function safeReadJsonValidated<T>(
  system: SystemAdapter,
  path: string,
  validate: (data: unknown) => data is T
): T | null {
  const data = safeReadJson<unknown>(system, path);
  if (data === null) {
    return null;
  }

  if (validate(data)) {
    return data;
  }

  return null;
}

// ========== Internal Helpers ==========

/**
 * Check if error is ENOENT (file not found)
 */
function isEnoentError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code: string }).code === 'ENOENT'
  );
}
