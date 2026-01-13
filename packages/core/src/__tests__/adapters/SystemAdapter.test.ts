/**
 * NodeSystemAdapter integration tests
 *
 * Tests the real NodeSystemAdapter with actual file system operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NodeSystemAdapter } from '../../adapters/NodeSystemAdapter';
import { createTempDir, TestRepo } from '../fixtures/testRepo';

describe('NodeSystemAdapter', () => {
  let adapter: NodeSystemAdapter;
  let tempDir: TestRepo;

  beforeEach(() => {
    adapter = new NodeSystemAdapter('bash');
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
      const filePath = path.join(tempDir.path, 'test.txt');
      expect(adapter.exists(filePath)).toBe(false);

      fs.writeFileSync(filePath, 'content');
      expect(adapter.exists(filePath)).toBe(true);
    });

    it('can read files', () => {
      const filePath = path.join(tempDir.path, 'test.txt');
      fs.writeFileSync(filePath, 'hello world');

      expect(adapter.readFile(filePath)).toBe('hello world');
    });

    it('can write files', () => {
      const filePath = path.join(tempDir.path, 'new-file.txt');
      adapter.writeFile(filePath, 'new content');

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('new content');
    });

    it('throws on reading non-existent file', () => {
      const filePath = path.join(tempDir.path, 'does-not-exist.txt');
      expect(() => adapter.readFile(filePath)).toThrow();
    });

    it('can create directories', () => {
      const dirPath = path.join(tempDir.path, 'subdir');
      adapter.mkdir(dirPath);

      expect(fs.existsSync(dirPath)).toBe(true);
      expect(fs.statSync(dirPath).isDirectory()).toBe(true);
    });

    it('can delete files', () => {
      const filePath = path.join(tempDir.path, 'to-delete.txt');
      fs.writeFileSync(filePath, 'content');

      adapter.unlink(filePath);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('can list directory contents', () => {
      fs.writeFileSync(path.join(tempDir.path, 'file1.txt'), '1');
      fs.writeFileSync(path.join(tempDir.path, 'file2.txt'), '2');
      fs.mkdirSync(path.join(tempDir.path, 'subdir'));

      const entries = adapter.readDir(tempDir.path);

      expect(entries).toContain('file1.txt');
      expect(entries).toContain('file2.txt');
      expect(entries).toContain('subdir');
    });

    it('can copy files', () => {
      const srcPath = path.join(tempDir.path, 'source.txt');
      const destPath = path.join(tempDir.path, 'dest.txt');

      fs.writeFileSync(srcPath, 'source content');
      adapter.copyFile(srcPath, destPath);

      expect(fs.readFileSync(destPath, 'utf-8')).toBe('source content');
    });

    it('can get file stats', () => {
      const filePath = path.join(tempDir.path, 'test.txt');
      fs.writeFileSync(filePath, 'content');

      const stat = adapter.stat(filePath);

      expect(stat.isFile()).toBe(true);
      expect(stat.isDirectory()).toBe(false);
      expect(stat.mtimeMs).toBeGreaterThan(0);
    });

    it('can recursively remove directories', () => {
      const dirPath = path.join(tempDir.path, 'nested');
      fs.mkdirSync(path.join(dirPath, 'deep', 'dir'), { recursive: true });
      fs.writeFileSync(path.join(dirPath, 'deep', 'file.txt'), 'content');

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
    it('can execute sync commands', () => {
      const result = adapter.execSync('echo hello', tempDir.path);
      expect(result.trim()).toBe('hello');
    });

    it('can execute async commands', async () => {
      const result = await adapter.exec('echo world', tempDir.path);
      expect(result.trim()).toBe('world');
    });

    it('throws on failed sync command', () => {
      expect(() => {
        adapter.execSync('exit 1', tempDir.path);
      }).toThrow();
    });

    it('rejects on failed async command', async () => {
      await expect(adapter.exec('exit 1', tempDir.path)).rejects.toThrow();
    });
  });
});
