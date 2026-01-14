/**
 * NodeSystemAdapter integration tests
 *
 * Tests the real NodeSystemAdapter with actual file system operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { NodeSystemAdapter } from '../../adapters/NodeSystemAdapter';
import { SystemAdapter } from '../../adapters/SystemAdapter';
import { createTempDir, TestRepo, getTestSystemAdapter } from '../fixtures/testRepo';

describe('NodeSystemAdapter', () => {
  let adapter: NodeSystemAdapter;
  let execAdapter: SystemAdapter; // Platform-appropriate adapter for command execution
  let tempDir: TestRepo;

  beforeEach(() => {
    adapter = new NodeSystemAdapter('bash');
    execAdapter = getTestSystemAdapter();
    tempDir = createTempDir('system-adapter-test-');
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  describe('platform detection', () => {
    it('returns a valid platform', () => {
      const platform = adapter.getPlatform();
      expect(['linux', 'darwin', 'win32']).toContain(platform);
    });

    it('returns terminal type', () => {
      expect(adapter.getTerminalType()).toBe('bash');
    });

    it('returns home directory', () => {
      const home = adapter.getHomeDirectory();
      expect(home).toBeTruthy();
      expect(typeof home).toBe('string');
    });
  });

  describe('file system operations', () => {
    it('can check if file exists', () => {
      const filePath = adapter.joinPath(tempDir.path, 'test.txt');
      expect(adapter.exists(filePath)).toBe(false);

      fs.writeFileSync(filePath, 'content');
      expect(adapter.exists(filePath)).toBe(true);
    });

    it('can read files', () => {
      const filePath = adapter.joinPath(tempDir.path, 'test.txt');
      fs.writeFileSync(filePath, 'hello world');

      expect(adapter.readFile(filePath)).toBe('hello world');
    });

    it('can write files', () => {
      const filePath = adapter.joinPath(tempDir.path, 'new-file.txt');
      adapter.writeFile(filePath, 'new content');

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('new content');
    });

    it('throws on reading non-existent file', () => {
      const filePath = adapter.joinPath(tempDir.path, 'does-not-exist.txt');
      expect(() => adapter.readFile(filePath)).toThrow();
    });

    it('can create directories', () => {
      const dirPath = adapter.joinPath(tempDir.path, 'subdir');
      adapter.mkdir(dirPath);

      expect(fs.existsSync(dirPath)).toBe(true);
      expect(fs.statSync(dirPath).isDirectory()).toBe(true);
    });

    it('can delete files', () => {
      const filePath = adapter.joinPath(tempDir.path, 'to-delete.txt');
      fs.writeFileSync(filePath, 'content');

      adapter.unlink(filePath);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('can list directory contents', () => {
      fs.writeFileSync(adapter.joinPath(tempDir.path, 'file1.txt'), '1');
      fs.writeFileSync(adapter.joinPath(tempDir.path, 'file2.txt'), '2');
      fs.mkdirSync(adapter.joinPath(tempDir.path, 'subdir'));

      const entries = adapter.readDir(tempDir.path);

      expect(entries).toContain('file1.txt');
      expect(entries).toContain('file2.txt');
      expect(entries).toContain('subdir');
    });

    it('can copy files', () => {
      const srcPath = adapter.joinPath(tempDir.path, 'source.txt');
      const destPath = adapter.joinPath(tempDir.path, 'dest.txt');

      fs.writeFileSync(srcPath, 'source content');
      adapter.copyFile(srcPath, destPath);

      expect(fs.readFileSync(destPath, 'utf-8')).toBe('source content');
    });

    it('can get file stats', () => {
      const filePath = adapter.joinPath(tempDir.path, 'test.txt');
      fs.writeFileSync(filePath, 'content');

      const stat = adapter.stat(filePath);

      expect(stat.isFile()).toBe(true);
      expect(stat.isDirectory()).toBe(false);
      expect(stat.mtimeMs).toBeGreaterThan(0);
    });

    it('can recursively remove directories', () => {
      const dirPath = adapter.joinPath(tempDir.path, 'nested');
      fs.mkdirSync(adapter.joinPath(dirPath, 'deep', 'dir'), { recursive: true });
      fs.writeFileSync(adapter.joinPath(dirPath, 'deep', 'file.txt'), 'content');

      adapter.rmdir(dirPath, { recursive: true });

      expect(fs.existsSync(dirPath)).toBe(false);
    });
  });

  describe('path operations', () => {
    it('joins paths correctly', () => {
      const joined = adapter.joinPath('/base', 'sub', 'file.txt');
      expect(joined).toContain('base');
      expect(joined).toContain('sub');
      expect(joined).toContain('file.txt');
    });

    it('converts paths based on context', () => {
      const testPath = tempDir.path;

      // All contexts should return valid paths
      expect(adapter.convertPath(testPath, 'nodeFs')).toBeTruthy();
      expect(adapter.convertPath(testPath, 'terminal')).toBeTruthy();
      expect(adapter.convertPath(testPath, 'display')).toBeTruthy();
    });
  });

  describe('command execution', () => {
    // These tests use execAdapter which auto-selects the right terminal type (wsl on Windows, bash on Unix)
    it('can execute sync commands', () => {
      const result = execAdapter.execSync('echo hello', tempDir.path);
      expect(result.trim()).toBe('hello');
    });

    it('can execute async commands', async () => {
      const result = await execAdapter.exec('echo world', tempDir.path);
      expect(result.trim()).toBe('world');
    });

    it('throws on failed sync command', () => {
      expect(() => {
        execAdapter.execSync('exit 1', tempDir.path);
      }).toThrow();
    });

    it('rejects on failed async command', async () => {
      await expect(execAdapter.exec('exit 1', tempDir.path)).rejects.toThrow();
    });
  });
});
