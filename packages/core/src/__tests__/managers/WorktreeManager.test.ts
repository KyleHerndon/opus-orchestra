/**
 * WorktreeManager integration tests
 *
 * Tests WorktreeManager with real git repositories and file system.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WorktreeManager } from '../../managers/WorktreeManager';
import { NodeSystemAdapter } from '../../adapters/NodeSystemAdapter';
import { ConfigAdapter } from '../../adapters/ConfigAdapter';
import { createTestRepoWithConfig, TestRepo } from '../fixtures/testRepo';

/**
 * Simple ConfigAdapter implementation for testing
 */
class TestConfigAdapter implements ConfigAdapter {
  private config: Record<string, unknown>;
  private listeners: Set<() => void> = new Set();

  constructor(initialConfig: Record<string, unknown> = {}) {
    this.config = {
      worktreeDirectory: '.worktrees',
      ...initialConfig,
    };
  }

  get<K extends string>(key: K): unknown {
    return this.config[key];
  }

  getAll(): Record<string, unknown> {
    return { ...this.config };
  }

  async update<K extends string>(key: K, value: unknown): Promise<void> {
    this.config[key] = value;
    this.listeners.forEach(fn => fn());
  }

  onDidChange(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  refresh(): void {
    // No-op for tests
  }

  dispose(): void {
    this.listeners.clear();
  }
}

describe('WorktreeManager', () => {
  let testRepo: TestRepo;
  let system: NodeSystemAdapter;
  let config: TestConfigAdapter;
  let manager: WorktreeManager;

  beforeEach(() => {
    testRepo = createTestRepoWithConfig('worktree-manager-test-');
    system = new NodeSystemAdapter('bash');
    config = new TestConfigAdapter({ worktreeDirectory: '.worktrees' });
    manager = new WorktreeManager(system, config);
  });

  afterEach(() => {
    testRepo.cleanup();
  });

  describe('worktreeExists', () => {
    it('returns false when worktree does not exist', () => {
      const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-alpha');
      expect(manager.worktreeExists(worktreePath)).toBe(false);
    });

    it('returns true when worktree exists', () => {
      const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-alpha');
      fs.mkdirSync(worktreePath, { recursive: true });

      expect(manager.worktreeExists(worktreePath)).toBe(true);
    });
  });

  describe('getWorktreePath', () => {
    it('returns correct worktree path for agent name', () => {
      const worktreePath = manager.getWorktreePath(testRepo.path, 'alpha');
      expect(worktreePath).toBe(path.join(testRepo.path, '.worktrees', 'claude-alpha'));
    });

    it('respects custom worktree directory config', () => {
      config = new TestConfigAdapter({ worktreeDirectory: 'custom-worktrees' });
      manager = new WorktreeManager(system, config);

      const worktreePath = manager.getWorktreePath(testRepo.path, 'bravo');
      expect(worktreePath).toBe(path.join(testRepo.path, 'custom-worktrees', 'claude-bravo'));
    });
  });

  describe('createWorktree', () => {
    it('creates a git worktree', () => {
      const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-alpha');

      manager.createWorktree(testRepo.path, worktreePath, 'claude-alpha', 'main');

      expect(fs.existsSync(worktreePath)).toBe(true);
      expect(fs.existsSync(path.join(worktreePath, '.git'))).toBe(true);
    });

    it('creates worktree with new branch from base', () => {
      const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-bravo');

      manager.createWorktree(testRepo.path, worktreePath, 'claude-bravo', 'main');

      // Verify the branch exists
      expect(fs.existsSync(worktreePath)).toBe(true);
    });
  });

  describe('removeWorktree', () => {
    it('removes an existing worktree', () => {
      const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-alpha');

      // Create worktree first
      manager.createWorktree(testRepo.path, worktreePath, 'claude-alpha', 'main');
      expect(fs.existsSync(worktreePath)).toBe(true);

      // Remove it
      manager.removeWorktree(testRepo.path, worktreePath, 'claude-alpha');

      expect(fs.existsSync(worktreePath)).toBe(false);
    });

    it('handles already-removed worktree gracefully', () => {
      const worktreePath = path.join(testRepo.path, '.worktrees', 'nonexistent');

      // Should not throw
      expect(() => {
        manager.removeWorktree(testRepo.path, worktreePath, 'nonexistent');
      }).not.toThrow();
    });
  });

  describe('saveAgentMetadata', () => {
    it('saves agent metadata to JSON file', () => {
      const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-alpha');
      fs.mkdirSync(worktreePath, { recursive: true });

      const agent = {
        id: 1,
        name: 'alpha',
        sessionId: 'test-session-123',
        branch: 'claude-alpha',
        worktreePath,
        repoPath: testRepo.path,
        taskFile: null,
        terminal: null,
        status: 'idle' as const,
        statusIcon: 'circle-outline',
        pendingApproval: null,
        lastInteractionTime: new Date(),
        diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
        todos: [],
      };

      manager.saveAgentMetadata(agent);

      const metadataPath = path.join(worktreePath, '.opus-orchestra', 'agent.json');
      expect(fs.existsSync(metadataPath)).toBe(true);

      const savedData = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      expect(savedData.id).toBe(1);
      expect(savedData.name).toBe('alpha');
      expect(savedData.sessionId).toBe('test-session-123');
      expect(savedData.branch).toBe('claude-alpha');
    });
  });

  describe('loadAgentMetadata', () => {
    it('loads agent metadata from JSON file', () => {
      const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-alpha');
      const metadataDir = path.join(worktreePath, '.opus-orchestra');
      fs.mkdirSync(metadataDir, { recursive: true });

      const metadata = {
        id: 2,
        name: 'bravo',
        sessionId: 'session-456',
        branch: 'claude-bravo',
        worktreePath,
        repoPath: testRepo.path,
        taskFile: 'feature.md',
      };
      fs.writeFileSync(
        path.join(metadataDir, 'agent.json'),
        JSON.stringify(metadata)
      );

      const result = manager.loadAgentMetadata(worktreePath);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(2);
      expect(result?.name).toBe('bravo');
      expect(result?.sessionId).toBe('session-456');
      expect(result?.taskFile).toBe('feature.md');
    });

    it('returns null when metadata file does not exist', () => {
      const worktreePath = path.join(testRepo.path, '.worktrees', 'nonexistent');
      const result = manager.loadAgentMetadata(worktreePath);
      expect(result).toBeNull();
    });

    it('returns null when metadata file is invalid JSON', () => {
      const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-alpha');
      const metadataDir = path.join(worktreePath, '.opus-orchestra');
      fs.mkdirSync(metadataDir, { recursive: true });
      fs.writeFileSync(path.join(metadataDir, 'agent.json'), 'not valid json');

      const result = manager.loadAgentMetadata(worktreePath);
      expect(result).toBeNull();
    });
  });

  describe('scanWorktreesForAgents', () => {
    it('finds agents with metadata in worktrees directory', () => {
      // Create worktrees with metadata
      const alphaPath = path.join(testRepo.path, '.worktrees', 'claude-alpha');
      const bravoPath = path.join(testRepo.path, '.worktrees', 'claude-bravo');

      fs.mkdirSync(path.join(alphaPath, '.opus-orchestra'), { recursive: true });
      fs.mkdirSync(path.join(bravoPath, '.opus-orchestra'), { recursive: true });

      fs.writeFileSync(
        path.join(alphaPath, '.opus-orchestra', 'agent.json'),
        JSON.stringify({
          id: 1,
          name: 'alpha',
          sessionId: 'session-1',
          branch: 'claude-alpha',
          worktreePath: alphaPath,
          repoPath: testRepo.path,
        })
      );

      fs.writeFileSync(
        path.join(bravoPath, '.opus-orchestra', 'agent.json'),
        JSON.stringify({
          id: 2,
          name: 'bravo',
          sessionId: 'session-2',
          branch: 'claude-bravo',
          worktreePath: bravoPath,
          repoPath: testRepo.path,
        })
      );

      const agents = manager.scanWorktreesForAgents(testRepo.path);

      expect(agents).toHaveLength(2);
      expect(agents.map(a => a.name).sort()).toEqual(['alpha', 'bravo']);
    });

    it('ignores directories without agent metadata', () => {
      const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-alpha');
      fs.mkdirSync(worktreePath, { recursive: true });
      // No agent.json file

      const agents = manager.scanWorktreesForAgents(testRepo.path);
      expect(agents).toHaveLength(0);
    });

    it('ignores non-agent directories', () => {
      const randomDir = path.join(testRepo.path, '.worktrees', 'random-dir');
      fs.mkdirSync(path.join(randomDir, '.opus-orchestra'), { recursive: true });
      fs.writeFileSync(
        path.join(randomDir, '.opus-orchestra', 'agent.json'),
        JSON.stringify({ id: 1, name: 'test' })
      );

      const agents = manager.scanWorktreesForAgents(testRepo.path);
      expect(agents).toHaveLength(0); // 'random-dir' doesn't start with 'claude-'
    });

    it('returns empty array when worktrees directory does not exist', () => {
      // New temp dir without worktrees
      const agents = manager.scanWorktreesForAgents(testRepo.path);
      expect(agents).toEqual([]);
    });
  });
});
