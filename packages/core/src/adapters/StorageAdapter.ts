/**
 * StorageAdapter - Abstracts persistent storage operations
 *
 * This interface allows core logic to persist data without
 * depending on VS Code's workspace state API.
 *
 * Implementations:
 * - VSCodeStorageAdapter (packages/vscode) - VS Code workspace state
 * - FileStorageAdapter - File-based storage for CLI/web
 * - MockStorageAdapter (tests) - In-memory storage for testing
 */

/**
 * StorageAdapter abstracts persistent storage operations.
 */
export interface StorageAdapter {
  /**
   * Get a value from storage.
   *
   * @param key - Storage key
   * @param defaultValue - Value to return if key doesn't exist
   * @returns Stored value or default value
   */
  get<T>(key: string, defaultValue: T): T;

  /**
   * Set a value in storage.
   *
   * @param key - Storage key
   * @param value - Value to store
   * @returns Promise that resolves when storage is complete
   */
  set<T>(key: string, value: T): Promise<void>;

  /**
   * Delete a value from storage.
   *
   * @param key - Storage key
   * @returns Promise that resolves when deletion is complete
   */
  delete(key: string): Promise<void>;

  /**
   * Check if storage is available and working.
   *
   * @returns true if storage is available
   */
  isAvailable(): boolean;

  /**
   * Get all keys in storage.
   *
   * @returns Array of all storage keys
   */
  keys(): string[];

  /**
   * Clear all storage.
   *
   * @returns Promise that resolves when clear is complete
   */
  clear(): Promise<void>;
}
