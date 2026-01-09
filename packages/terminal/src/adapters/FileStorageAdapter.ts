/**
 * FileStorageAdapter - File-based storage implementation
 *
 * Uses the `conf` library for persistent JSON file storage.
 * Stores data in `.opus-orchestra/storage.json` (project) or
 * `~/.config/opus-orchestra/storage.json` (user global).
 */

import Conf from 'conf';
import type { StorageAdapter } from '@opus-orchestra/core';

export class FileStorageAdapter implements StorageAdapter {
  private store: Conf<Record<string, unknown>>;

  /**
   * Create a new FileStorageAdapter.
   *
   * @param projectPath - Optional project directory for project-local storage
   */
  constructor(projectPath?: string) {
    this.store = new Conf({
      projectName: 'opus-orchestra',
      configName: 'storage',
      cwd: projectPath ? `${projectPath}/.opus-orchestra` : undefined,
    });
  }

  get<T>(key: string, defaultValue: T): T {
    return this.store.get(key, defaultValue) as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  isAvailable(): boolean {
    try {
      // Test write/read to verify storage works
      const testKey = '__storage_test__';
      this.store.set(testKey, true);
      this.store.delete(testKey);
      return true;
    } catch {
      return false;
    }
  }

  keys(): string[] {
    return Object.keys(this.store.store);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  /**
   * Get the path to the storage file.
   */
  get path(): string {
    return this.store.path;
  }
}
