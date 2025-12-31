/**
 * SystemAdapter tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockSystemAdapter } from '../mocks/MockSystemAdapter';

describe('MockSystemAdapter', () => {
  let adapter: MockSystemAdapter;

  beforeEach(() => {
    adapter = new MockSystemAdapter();
  });

  describe('platform detection', () => {
    it('defaults to linux platform', () => {
      expect(adapter.getPlatform()).toBe('linux');
    });

    it('can set platform', () => {
      adapter.setPlatform('win32');
      expect(adapter.getPlatform()).toBe('win32');
    });

    it('defaults to bash terminal type', () => {
      expect(adapter.getTerminalType()).toBe('bash');
    });

    it('can set terminal type', () => {
      adapter.setTerminalType('wsl');
      expect(adapter.getTerminalType()).toBe('wsl');
    });
  });

  describe('file system operations', () => {
    it('can add and read files', () => {
      adapter.addFile('/test/file.txt', 'hello world');
      expect(adapter.exists('/test/file.txt')).toBe(true);
      expect(adapter.readFile('/test/file.txt')).toBe('hello world');
    });

    it('can write files', () => {
      adapter.writeFile('/new/file.txt', 'content');
      expect(adapter.readFile('/new/file.txt')).toBe('content');
    });

    it('throws on reading non-existent file', () => {
      expect(() => adapter.readFile('/does/not/exist')).toThrow();
    });

    it('can delete files', () => {
      adapter.addFile('/test/file.txt', 'content');
      adapter.unlink('/test/file.txt');
      expect(adapter.exists('/test/file.txt')).toBe(false);
    });

    it('can list directory contents', () => {
      adapter.addFile('/dir/file1.txt', '1');
      adapter.addFile('/dir/file2.txt', '2');
      adapter.addFile('/dir/sub/file3.txt', '3');

      const entries = adapter.readDir('/dir');
      expect(entries).toContain('file1.txt');
      expect(entries).toContain('file2.txt');
      expect(entries).toContain('sub');
      expect(entries.length).toBe(3);
    });
  });

  describe('path operations', () => {
    it('joins paths correctly', () => {
      const joined = adapter.joinPath('/base', 'sub', 'file.txt');
      expect(joined).toBe('/base/sub/file.txt');
    });

    it('normalizes multiple slashes', () => {
      const joined = adapter.joinPath('/base/', '/sub/', 'file.txt');
      expect(joined).toBe('/base/sub/file.txt');
    });

    it('returns home directory', () => {
      expect(adapter.getHomeDirectory()).toBe('/home/test');
    });

    it('can set home directory', () => {
      adapter.setHomeDirectory('/custom/home');
      expect(adapter.getHomeDirectory()).toBe('/custom/home');
    });
  });

  describe('command execution', () => {
    it('returns configured exec results', () => {
      adapter.setExecResult('git status', 'On branch main');
      expect(adapter.execSync('git status', '/any')).toBe('On branch main');
    });

    it('throws configured exec errors', () => {
      adapter.setExecError('git status', new Error('Not a repository'));
      expect(() => adapter.execSync('git status', '/any')).toThrow('Not a repository');
    });

    it('returns empty string for unconfigured commands', () => {
      expect(adapter.execSync('unknown command', '/any')).toBe('');
    });

    it('async exec returns promise', async () => {
      adapter.setExecResult('git status', 'On branch main');
      const result = await adapter.exec('git status', '/any');
      expect(result).toBe('On branch main');
    });
  });
});
