/**
 * Tests for FileConfigAdapter
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileConfigAdapter } from '../adapters/FileConfigAdapter.js';
import { getTestSystemAdapter } from './fixtures/testRepo.js';
import type { SystemAdapter } from '@opus-orchestra/core';
import * as fs from 'node:fs';
import * as os from 'node:os';

describe('FileConfigAdapter', () => {
  let tempDir: string;
  let adapter: FileConfigAdapter;
  let system: SystemAdapter;

  beforeEach(() => {
    system = getTestSystemAdapter();
    // Create a temp directory for testing
    tempDir = fs.mkdtempSync(system.joinPath(os.tmpdir(), 'opus-test-'));
    adapter = new FileConfigAdapter(tempDir);
  });

  afterEach(() => {
    adapter.dispose();
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('get', () => {
    it('should return default values for standard config keys', () => {
      // These are from DEFAULT_CONFIG in core
      expect(adapter.get('useTmux')).toBe(true);
      expect(adapter.get('defaultAgentCount')).toBe(3);
      expect(adapter.get('worktreeDirectory')).toBe('.worktrees');
      expect(adapter.get('autoStartClaudeOnFocus')).toBe(true);
      expect(adapter.get('tmuxSessionPrefix')).toBe('opus');
      expect(adapter.get('diffPollingInterval')).toBe(60000);
    });
  });

  describe('getAll', () => {
    it('should return all config values', () => {
      const allConfig = adapter.getAll();

      expect(allConfig).toHaveProperty('useTmux');
      expect(allConfig).toHaveProperty('defaultAgentCount');
      expect(allConfig).toHaveProperty('worktreeDirectory');
    });
  });

  describe('config file loading', () => {
    it('should load config from file when present', () => {
      // Create config directory and file
      const configDir = system.joinPath(tempDir, '.opus-orchestra');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        system.joinPath(configDir, 'config.json'),
        JSON.stringify({
          defaultAgentCount: 5,
          tmuxSessionPrefix: 'custom',
        })
      );

      // Create new adapter to pick up the file
      const newAdapter = new FileConfigAdapter(tempDir);

      expect(newAdapter.get('defaultAgentCount')).toBe(5);
      expect(newAdapter.get('tmuxSessionPrefix')).toBe('custom');
      // Non-overridden values should still be defaults
      expect(newAdapter.get('useTmux')).toBe(true);

      newAdapter.dispose();
    });
  });

  describe('onDidChange', () => {
    it('should register change listener', () => {
      const unsubscribe = adapter.onDidChange(() => {
        // listener registered
      });

      expect(typeof unsubscribe).toBe('function');

      // Cleanup
      unsubscribe();
    });
  });

  describe('update', () => {
    it('should update config value', async () => {
      await adapter.update('defaultAgentCount', 10);
      expect(adapter.get('defaultAgentCount')).toBe(10);
    });
  });

  describe('refresh', () => {
    it('should not throw when called', () => {
      expect(() => adapter.refresh()).not.toThrow();
    });
  });
});
