/**
 * Tests for FileStorageAdapter
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileStorageAdapter } from '../adapters/FileStorageAdapter.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('FileStorageAdapter', () => {
  let tempDir: string;
  let adapter: FileStorageAdapter;

  beforeEach(() => {
    // Create a temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opus-test-'));
    adapter = new FileStorageAdapter(tempDir);
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('get/set', () => {
    it('should return default value for missing key', () => {
      const result = adapter.get('missing', 'default');
      expect(result).toBe('default');
    });

    it('should store and retrieve string values', async () => {
      await adapter.set('testKey', 'testValue');
      const result = adapter.get('testKey', 'default');
      expect(result).toBe('testValue');
    });

    it('should store and retrieve number values', async () => {
      await adapter.set('count', 42);
      const result = adapter.get<number>('count', 0);
      expect(result).toBe(42);
    });

    it('should store and retrieve boolean values', async () => {
      await adapter.set('enabled', true);
      const result = adapter.get<boolean>('enabled', false);
      expect(result).toBe(true);
    });

    it('should store and retrieve object values', async () => {
      const obj = { name: 'test', value: 123 };
      await adapter.set('config', obj);
      const result = adapter.get<typeof obj>('config', { name: '', value: 0 });
      expect(result).toEqual(obj);
    });

    it('should store and retrieve array values', async () => {
      const arr = [1, 2, 3, 4, 5];
      await adapter.set('numbers', arr);
      const result = adapter.get<number[]>('numbers', []);
      expect(result).toEqual(arr);
    });
  });

  describe('keys', () => {
    it('should return empty array when no keys exist', async () => {
      await adapter.clear();
      expect(adapter.keys()).toEqual([]);
    });

    it('should return all stored keys', async () => {
      await adapter.set('key1', 'value1');
      await adapter.set('key2', 'value2');
      const keys = adapter.keys();
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
    });
  });

  describe('delete', () => {
    it('should delete existing key', async () => {
      await adapter.set('toDelete', 'value');
      expect(adapter.keys()).toContain('toDelete');

      await adapter.delete('toDelete');
      expect(adapter.keys()).not.toContain('toDelete');
    });

    it('should not throw when deleting non-existent key', async () => {
      await expect(adapter.delete('nonExistent')).resolves.not.toThrow();
    });
  });

  describe('clear', () => {
    it('should remove all keys', async () => {
      await adapter.set('key1', 'value1');
      await adapter.set('key2', 'value2');

      await adapter.clear();

      expect(adapter.keys()).toEqual([]);
    });
  });

  describe('isAvailable', () => {
    it('should return true when storage is functional', () => {
      expect(adapter.isAvailable()).toBe(true);
    });
  });
});
