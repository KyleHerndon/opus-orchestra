/**
 * MockStorageAdapter - Mock implementation for testing
 */

import { StorageAdapter } from '../../adapters/StorageAdapter';

/**
 * Mock StorageAdapter for testing
 */
export class MockStorageAdapter implements StorageAdapter {
  private storage: Map<string, unknown> = new Map();

  get<T>(key: string, defaultValue: T): T {
    if (this.storage.has(key)) {
      return this.storage.get(key) as T;
    }
    return defaultValue;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.storage.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }

  isAvailable(): boolean {
    return true;
  }

  keys(): string[] {
    return Array.from(this.storage.keys());
  }

  async clear(): Promise<void> {
    this.storage.clear();
  }

  /**
   * Get raw storage map (for test assertions)
   */
  getStorage(): Map<string, unknown> {
    return new Map(this.storage);
  }
}
