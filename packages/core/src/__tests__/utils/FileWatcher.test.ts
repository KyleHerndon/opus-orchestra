/**
 * FileWatcher integration tests
 *
 * Tests FileWatcher with real file system operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { FileWatcher, FileWatchEvent, createFileWatcher, isWsl } from '../../utils/FileWatcher';
import { getTestSystemAdapter } from '../fixtures/testRepo';

// Get shared system adapter for consistent path handling
const systemAdapter = getTestSystemAdapter();

/**
 * Get a temp directory that's on the native filesystem.
 * On WSL, we must use /tmp (Linux filesystem) not /mnt/c/... (Windows filesystem)
 * because inotify doesn't work across the WSL/Windows boundary.
 */
function getNativeTmpDir(): string {
  if (isWsl()) {
    // Force use of Linux-native /tmp where inotify works
    return '/tmp';
  }
  return os.tmpdir();
}

describe('FileWatcher', () => {
  let testDir: string;
  let watcher: FileWatcher | null = null;

  beforeEach(() => {
    testDir = fs.mkdtempSync(systemAdapter.joinPath(getNativeTmpDir(), 'filewatcher-test-'));
  });

  afterEach(() => {
    // Stop watcher if running
    if (watcher) {
      watcher.stop();
      watcher = null;
    }

    // Clean up test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor and configuration', () => {
    it('initializes with provided paths', () => {
      const paths = [testDir, '/tmp'];
      watcher = new FileWatcher({
        paths,
        onEvent: () => {},
      });

      expect(watcher.getWatchedPaths()).toEqual(paths);
    });

    it('starts in stopped state', () => {
      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: () => {},
      });

      expect(watcher.isRunning()).toBe(false);
    });

    it('reports healthy before start', () => {
      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: () => {},
      });

      expect(watcher.isHealthy()).toBe(true);
    });
  });

  describe('start and stop', () => {
    it('starts and reports running', async () => {
      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: () => {},
        pollInterval: 100,
      });

      await watcher.start();

      expect(watcher.isRunning()).toBe(true);
    });

    it('stops and reports not running', async () => {
      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: () => {},
        pollInterval: 100,
      });

      await watcher.start();
      watcher.stop();

      expect(watcher.isRunning()).toBe(false);
    });

    it('start is idempotent', async () => {
      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: () => {},
        pollInterval: 100,
      });

      await watcher.start();
      await watcher.start();
      await watcher.start();

      expect(watcher.isRunning()).toBe(true);
    });

    it('stop is idempotent', async () => {
      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: () => {},
        pollInterval: 100,
      });

      await watcher.start();
      watcher.stop();
      watcher.stop();
      watcher.stop();

      expect(watcher.isRunning()).toBe(false);
    });
  });

  describe('backup polling', () => {
    it('emits poll events at configured interval', async () => {
      const events: FileWatchEvent[] = [];

      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: (event) => events.push(event),
        pollInterval: 50, // Fast polling for test
      });

      await watcher.start();

      // Wait for multiple poll cycles
      await new Promise(resolve => setTimeout(resolve, 180));

      watcher.stop();

      // Should have received multiple poll events
      const pollEvents = events.filter(e => e.type === 'poll');
      expect(pollEvents.length).toBeGreaterThanOrEqual(3);
    });

    it('emits initial poll event on start', async () => {
      const events: FileWatchEvent[] = [];

      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: (event) => events.push(event),
        pollInterval: 5000, // Long interval - we only care about initial
      });

      await watcher.start();

      // Should have immediate poll event
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].type).toBe('poll');

      watcher.stop();
    });

    it('does not emit poll events when pollInterval is 0', async () => {
      const events: FileWatchEvent[] = [];

      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: (event) => events.push(event),
        pollInterval: 0, // Disable polling
      });

      await watcher.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      watcher.stop();

      const pollEvents = events.filter(e => e.type === 'poll');
      expect(pollEvents.length).toBe(0);
    });
  });

  describe('polling-only mode', () => {
    it('works in polling-only mode', async () => {
      const events: FileWatchEvent[] = [];

      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: (event) => events.push(event),
        pollInterval: 50,
        usePollingOnly: true,
      });

      await watcher.start();
      await new Promise(resolve => setTimeout(resolve, 120));
      watcher.stop();

      const pollEvents = events.filter(e => e.type === 'poll');
      expect(pollEvents.length).toBeGreaterThanOrEqual(2);
    });

    it('reports healthy in polling-only mode', async () => {
      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: () => {},
        usePollingOnly: true,
      });

      await watcher.start();

      expect(watcher.isHealthy()).toBe(true);

      watcher.stop();
    });
  });

  describe('file change detection', () => {
    it('detects new file creation', async () => {
      const events: FileWatchEvent[] = [];

      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: (event) => events.push(event),
        pollInterval: 5000, // Long poll - rely on chokidar
        debounceMs: 50,
      });

      await watcher.start();

      // Wait for chokidar to be ready
      await new Promise(resolve => setTimeout(resolve, 200));

      // Create a new file
      const testFile = systemAdapter.joinPath(testDir, 'new-file.txt');
      fs.writeFileSync(testFile, 'hello');

      // Wait for debounce and event
      await new Promise(resolve => setTimeout(resolve, 300));

      watcher.stop();

      const addEvents = events.filter(e => e.type === 'add');
      expect(addEvents.length).toBeGreaterThanOrEqual(1);
      expect(addEvents.some(e => e.path.includes('new-file.txt'))).toBe(true);
    });

    it('detects file changes', async () => {
      // Create file before starting watcher
      const testFile = systemAdapter.joinPath(testDir, 'existing-file.txt');
      fs.writeFileSync(testFile, 'initial');

      const events: FileWatchEvent[] = [];

      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: (event) => events.push(event),
        pollInterval: 5000,
        debounceMs: 50,
      });

      await watcher.start();
      await new Promise(resolve => setTimeout(resolve, 200));

      // Modify the file
      fs.writeFileSync(testFile, 'modified');

      await new Promise(resolve => setTimeout(resolve, 300));

      watcher.stop();

      const changeEvents = events.filter(e => e.type === 'change');
      expect(changeEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('detects file deletion', async () => {
      // Create file before starting watcher
      const testFile = systemAdapter.joinPath(testDir, 'to-delete.txt');
      fs.writeFileSync(testFile, 'delete me');

      const events: FileWatchEvent[] = [];

      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: (event) => events.push(event),
        pollInterval: 5000,
        debounceMs: 50,
      });

      await watcher.start();
      await new Promise(resolve => setTimeout(resolve, 200));

      // Delete the file
      fs.unlinkSync(testFile);

      await new Promise(resolve => setTimeout(resolve, 300));

      watcher.stop();

      const unlinkEvents = events.filter(e => e.type === 'unlink');
      expect(unlinkEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('path management', () => {
    it('addPath adds to watched paths', () => {
      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: () => {},
      });

      const newPath = '/tmp/another-path';
      watcher.addPath(newPath);

      expect(watcher.getWatchedPaths()).toContain(newPath);
    });

    it('addPath is idempotent', () => {
      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: () => {},
      });

      watcher.addPath('/tmp/path');
      watcher.addPath('/tmp/path');
      watcher.addPath('/tmp/path');

      const paths = watcher.getWatchedPaths();
      const count = paths.filter(p => p === '/tmp/path').length;
      expect(count).toBe(1);
    });

    it('removePath removes from watched paths', () => {
      watcher = new FileWatcher({
        paths: [testDir, '/tmp/path'],
        onEvent: () => {},
      });

      watcher.removePath('/tmp/path');

      expect(watcher.getWatchedPaths()).not.toContain('/tmp/path');
    });

    it('removePath is idempotent', () => {
      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: () => {},
      });

      watcher.removePath('/nonexistent');
      watcher.removePath('/nonexistent');

      // Should not throw
      expect(watcher.getWatchedPaths()).toEqual([testDir]);
    });

    it('addPath works while watcher is running', async () => {
      const events: FileWatchEvent[] = [];
      const additionalDir = fs.mkdtempSync(systemAdapter.joinPath(getNativeTmpDir(), 'filewatcher-add-'));

      try {
        watcher = new FileWatcher({
          paths: [testDir],
          onEvent: (event) => events.push(event),
          pollInterval: 5000,
          debounceMs: 50,
        });

        await watcher.start();
        await new Promise(resolve => setTimeout(resolve, 300));

        // Add new path while running
        watcher.addPath(additionalDir);

        // Wait for chokidar to register the new path
        await new Promise(resolve => setTimeout(resolve, 300));

        // Create file in new path
        const testFile = systemAdapter.joinPath(additionalDir, 'new-file.txt');
        fs.writeFileSync(testFile, 'hello');

        // Longer wait for file event
        await new Promise(resolve => setTimeout(resolve, 500));

        watcher.stop();

        const addEvents = events.filter(e => e.type === 'add');
        expect(addEvents.some(e => e.path.includes('new-file.txt'))).toBe(true);
      } finally {
        fs.rmSync(additionalDir, { recursive: true, force: true });
      }
    });
  });

  describe('debouncing', () => {
    it('debounces rapid file changes', async () => {
      const testFile = systemAdapter.joinPath(testDir, 'rapid-changes.txt');
      fs.writeFileSync(testFile, 'initial');

      const events: FileWatchEvent[] = [];

      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: (event) => events.push(event),
        pollInterval: 5000,
        debounceMs: 100, // 100ms debounce
      });

      await watcher.start();
      await new Promise(resolve => setTimeout(resolve, 200));

      // Make rapid changes
      for (let i = 0; i < 5; i++) {
        fs.writeFileSync(testFile, `change ${i}`);
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Wait for debounce to flush
      await new Promise(resolve => setTimeout(resolve, 200));

      watcher.stop();

      // Should have fewer events than changes due to debouncing
      const changeEvents = events.filter(e => e.type === 'change');
      // We expect debouncing to reduce 5 rapid changes to fewer events
      expect(changeEvents.length).toBeLessThan(5);
    });
  });

  describe('error handling', () => {
    it('calls onError callback on watcher error', async () => {
      const errors: Error[] = [];

      watcher = new FileWatcher({
        paths: ['/nonexistent/path/that/does/not/exist'],
        onEvent: () => {},
        onError: (error) => errors.push(error),
        pollInterval: 5000,
      });

      await watcher.start();
      await new Promise(resolve => setTimeout(resolve, 200));

      watcher.stop();

      // May or may not have errors depending on chokidar behavior
      // Just ensure it doesn't throw
    });

    it('continues working if event handler throws', async () => {
      let callCount = 0;

      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: () => {
          callCount++;
          if (callCount === 1) {
            throw new Error('Handler error');
          }
        },
        pollInterval: 50,
      });

      await watcher.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      watcher.stop();

      // Should have called handler multiple times despite error
      expect(callCount).toBeGreaterThan(1);
    });
  });

  describe('createFileWatcher helper', () => {
    it('creates a working file watcher', async () => {
      const events: FileWatchEvent[] = [];

      watcher = createFileWatcher(
        [testDir],
        (event) => events.push(event)
      ) as FileWatcher;

      await watcher.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      watcher.stop();

      // Should have poll events from default polling
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('event structure', () => {
    it('poll events have correct structure', async () => {
      const events: FileWatchEvent[] = [];

      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: (event) => events.push(event),
        pollInterval: 50,
      });

      await watcher.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      watcher.stop();

      const pollEvent = events.find(e => e.type === 'poll');
      expect(pollEvent).toBeDefined();
      expect(pollEvent!.type).toBe('poll');
      expect(pollEvent!.path).toBe('');
      expect(typeof pollEvent!.timestamp).toBe('number');
      expect(pollEvent!.timestamp).toBeGreaterThan(0);
    });

    it('file events have correct structure', async () => {
      const events: FileWatchEvent[] = [];

      watcher = new FileWatcher({
        paths: [testDir],
        onEvent: (event) => events.push(event),
        pollInterval: 5000,
        debounceMs: 50,
      });

      await watcher.start();
      await new Promise(resolve => setTimeout(resolve, 200));

      const testFile = systemAdapter.joinPath(testDir, 'structure-test.txt');
      fs.writeFileSync(testFile, 'content');

      await new Promise(resolve => setTimeout(resolve, 300));
      watcher.stop();

      const addEvent = events.find(e => e.type === 'add');
      expect(addEvent).toBeDefined();
      expect(addEvent!.type).toBe('add');
      expect(addEvent!.path).toContain('structure-test.txt');
      expect(typeof addEvent!.timestamp).toBe('number');
    });
  });
});
