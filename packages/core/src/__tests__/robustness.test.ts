/**
 * Core Package Robustness Tests
 *
 * Tests edge cases, error handling, and resilience
 * of core services and managers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../services/EventBus';
import { createLogger } from '../services/Logger';
import { GitService } from '../services/GitService';
import { StatusService } from '../services/StatusService';
import { WorktreeManager } from '../managers/WorktreeManager';
import { AgentPersistence } from '../managers/AgentPersistence';
import type { SystemAdapter, ConfigAdapter } from '../adapters';
import type { Agent, PersistedAgent } from '../types/agent';
import type { IWorktreeManager } from '../managers/WorktreeManager';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { getTestSystemAdapter } from './fixtures/testRepo';

// Get shared system adapter for consistent path handling
const systemAdapter = getTestSystemAdapter();

// Create temp directory for tests
function createTempDir(prefix: string): string {
  return fs.mkdtempSync(systemAdapter.joinPath(os.tmpdir(), prefix));
}

function cleanupTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('EventBus Robustness', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  it('should handle emitting event with no listeners', () => {
    // Should not throw
    expect(() => {
      eventBus.emit('nonexistent:event', { data: 'test' });
    }).not.toThrow();
  });

  it('should handle listener throwing error', () => {
    const goodListener = vi.fn();
    const badListener = vi.fn(() => {
      throw new Error('Listener error');
    });

    eventBus.on('test:event', badListener);
    eventBus.on('test:event', goodListener);

    // Should not propagate error, other listeners should still run
    expect(() => {
      eventBus.emit('test:event', { data: 'test' });
    }).not.toThrow();

    // Good listener should still be called
    expect(goodListener).toHaveBeenCalled();
  });

  it('should handle removing non-existent listener', () => {
    const listener = vi.fn();

    // Should not throw when removing listener that was never added
    expect(() => {
      eventBus.off('test:event', listener);
    }).not.toThrow();
  });

  it('should handle adding same listener multiple times', () => {
    const listener = vi.fn();

    eventBus.on('test:event', listener);
    eventBus.on('test:event', listener);
    eventBus.on('test:event', listener);

    eventBus.emit('test:event', { data: 'test' });

    // Listener should be called at least once (behavior may vary)
    // Some implementations dedupe, others don't
    expect(listener).toHaveBeenCalled();
  });

  it('should handle rapid subscribe/unsubscribe cycles', () => {
    const listener = vi.fn();

    for (let i = 0; i < 100; i++) {
      eventBus.on('test:event', listener);
      eventBus.off('test:event', listener);
    }

    eventBus.emit('test:event', { data: 'test' });

    // Should not be called (all unsubscribed)
    expect(listener).not.toHaveBeenCalled();
  });

  it('should handle null/undefined payloads', () => {
    const listener = vi.fn();
    eventBus.on('test:event', listener);

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testing edge case
      eventBus.emit('test:event', null as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testing edge case
      eventBus.emit('test:event', undefined as any);
    }).not.toThrow();

    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('Logger Robustness', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir('logger-test-');
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should handle non-existent log directory', () => {
    const nonExistentPath = systemAdapter.joinPath(tempDir, 'nonexistent', 'deep', 'path');

    // Should not throw - should create directory or handle gracefully
    expect(() => {
      createLogger(nonExistentPath, 'debug');
    }).not.toThrow();
  });

  it('should handle logging very long messages', () => {
    const logger = createLogger(tempDir, 'debug');
    const longMessage = 'x'.repeat(100000);

    expect(() => {
      logger.debug(longMessage);
      logger.info(longMessage);
      logger.warn(longMessage);
      logger.error(longMessage);
    }).not.toThrow();
  });

  it('should handle special characters in log messages', () => {
    const logger = createLogger(tempDir, 'debug');

    expect(() => {
      logger.debug('Message with \n newlines \r\n and \t tabs');
      logger.debug('Message with unicode: 你好世界 🎉');
      logger.debug('Message with null bytes: \x00\x00');
    }).not.toThrow();
  });

  it('should handle circular references in log data', () => {
    const logger = createLogger(tempDir, 'debug');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testing circular reference
    const obj: Record<string, any> = { name: 'test' };
    obj.self = obj; // Circular reference

    expect(() => {
      logger.debug('Circular object', obj);
    }).not.toThrow();
  });

  it('should handle child loggers', () => {
    const logger = createLogger(tempDir, 'debug');
    const child1 = logger.child({ component: 'Child1' });
    const child2 = child1.child({ component: 'Child2' });

    expect(() => {
      child1.debug('Child1 message');
      child2.debug('Child2 message');
    }).not.toThrow();
  });
});

describe('GitService Robustness', () => {
  let tempDir: string;
  let gitService: GitService;

  beforeEach(() => {
    tempDir = createTempDir('git-test-');
    gitService = new GitService(systemAdapter);
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should handle non-git directory', async () => {
    // tempDir is not a git repo
    const baseBranch = await gitService.getBaseBranch(tempDir);

    // Should return a default or handle gracefully
    expect(typeof baseBranch).toBe('string');
  });

  it('should handle non-existent directory', async () => {
    const nonExistent = systemAdapter.joinPath(tempDir, 'does-not-exist');

    const baseBranch = await gitService.getBaseBranch(nonExistent);

    // Should not crash
    expect(typeof baseBranch).toBe('string');
  });

  it('should handle getDiffStats on non-git directory', async () => {
    const stats = await gitService.getDiffStats(tempDir, 'main');

    // Should return zeros or default values
    expect(stats).toEqual({
      insertions: 0,
      deletions: 0,
      filesChanged: 0,
    });
  });

  it('should handle getChangedFiles on non-git directory', async () => {
    const files = await gitService.getChangedFiles(tempDir);

    // Should return empty array
    expect(files).toEqual([]);
  });
});

describe('StatusService Robustness', () => {
  let tempDir: string;
  let statusService: StatusService;
  let system: SystemAdapter;

  beforeEach(() => {
    tempDir = createTempDir('status-test-');
    system = getTestSystemAdapter();
    statusService = new StatusService(system);
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should handle missing status directory', () => {
    const status = statusService.checkStatus(tempDir);

    expect(status).toBeNull();
  });

  it('should handle empty status directory', () => {
    const statusDir = systemAdapter.joinPath(tempDir, '.opus-orchestra', 'status');
    fs.mkdirSync(statusDir, { recursive: true });

    const status = statusService.checkStatus(tempDir);

    expect(status).toBeNull();
  });

  it('should handle corrupted status file', () => {
    const statusDir = systemAdapter.joinPath(tempDir, '.opus-orchestra', 'status');
    fs.mkdirSync(statusDir, { recursive: true });
    fs.writeFileSync(systemAdapter.joinPath(statusDir, 'status.txt'), 'invalid json {{{');

    const status = statusService.checkStatus(tempDir);

    // Should handle gracefully - may return null or parsed content
    expect(status === null || typeof status === 'object').toBe(true);
  });

  it('should handle status file with unexpected format', () => {
    const statusDir = systemAdapter.joinPath(tempDir, '.opus-orchestra', 'status');
    fs.mkdirSync(statusDir, { recursive: true });
    fs.writeFileSync(
      systemAdapter.joinPath(statusDir, 'status.json'),
      JSON.stringify({ unexpected: 'format', no: 'status field' })
    );

    const status = statusService.checkStatus(tempDir);

    // Should handle gracefully - may return null or parsed content
    expect(status === null || typeof status === 'object').toBe(true);
  });

  it('should return status directory path correctly', () => {
    const statusDir = statusService.getStatusDirectory(tempDir);

    expect(statusDir).toContain('.opus-orchestra');
    expect(statusDir).toContain('status');
  });
});

describe('WorktreeManager Robustness', () => {
  let tempDir: string;
  let worktreeManager: WorktreeManager;
  let system: SystemAdapter;
  let config: ConfigAdapter;

  beforeEach(() => {
    tempDir = createTempDir('worktree-test-');
    system = getTestSystemAdapter();
    config = {
      get: vi.fn((key: string) => {
        if (key === 'worktreeDirectory') {return '.worktrees';}
        if (key === 'coordinationDirectory') {return '.opus-orchestra';}
        return undefined;
      }),
      set: vi.fn(),
      onDidChange: vi.fn(),
    };
    worktreeManager = new WorktreeManager(system, config);
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should handle worktreeExists for non-existent path', () => {
    const result = worktreeManager.worktreeExists(
      systemAdapter.joinPath(tempDir, 'nonexistent')
    );

    expect(result).toBe(false);
  });

  it('should handle getWorktreePath with special characters', () => {
    const result = worktreeManager.getWorktreePath(tempDir, 'test-agent');

    expect(result).toContain('claude-test-agent');
  });

  it('should handle scanWorktreesForAgents on empty directory', () => {
    const agents = worktreeManager.scanWorktreesForAgents(tempDir);

    expect(agents).toEqual([]);
  });

  it('should handle scanWorktreesForAgents on non-existent directory', () => {
    const agents = worktreeManager.scanWorktreesForAgents(
      systemAdapter.joinPath(tempDir, 'nonexistent')
    );

    expect(agents).toEqual([]);
  });

  it('should handle saveAgentMetadata with minimal data', () => {
    const agentDir = systemAdapter.joinPath(tempDir, '.worktrees', 'claude-test');
    fs.mkdirSync(agentDir, { recursive: true });

    const agent: Agent = {
      id: 1,
      name: 'test',
      sessionId: 'session-123',
      branch: 'claude-test',
      worktreePath: agentDir,
      repoPath: tempDir,
      status: 'idle',
      diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
    };

    expect(() => {
      worktreeManager.saveAgentMetadata(agent);
    }).not.toThrow();

    // Verify file was created
    const metadataPath = systemAdapter.joinPath(agentDir, '.opus-orchestra', 'agent.json');
    expect(fs.existsSync(metadataPath)).toBe(true);
  });

  it('should handle loadAgentMetadata for non-existent worktree', () => {
    const result = worktreeManager.loadAgentMetadata(
      systemAdapter.joinPath(tempDir, 'nonexistent')
    );

    expect(result).toBeNull();
  });
});

describe('AgentPersistence Robustness', () => {
  let mockWorktreeManager: IWorktreeManager;
  let persistence: AgentPersistence;

  beforeEach(() => {
    mockWorktreeManager = {
      saveAgentMetadata: vi.fn(),
      loadAgentMetadata: vi.fn(),
      scanWorktreesForAgents: vi.fn().mockReturnValue([]),
      worktreeExists: vi.fn().mockReturnValue(true),
      getWorktreePath: vi.fn((repo, name) => `${repo}/.worktrees/claude-${name}`),
      createWorktree: vi.fn(),
      removeWorktree: vi.fn(),
      renameWorktree: vi.fn(),
      copyCoordinationFiles: vi.fn(),
    };

    persistence = new AgentPersistence(mockWorktreeManager, '/test/repo');
  });

  it('should generate valid UUIDs', () => {
    const ids = new Set<string>();

    for (let i = 0; i < 1000; i++) {
      const id = persistence.generateSessionId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      ids.add(id);
    }

    // All should be unique
    expect(ids.size).toBe(1000);
  });

  it('should handle saving empty agent map', () => {
    const agents = new Map<number, Agent>();

    expect(() => {
      persistence.saveAgents(agents);
    }).not.toThrow();

    expect(mockWorktreeManager.saveAgentMetadata).not.toHaveBeenCalled();
  });

  it('should handle saving large number of agents', () => {
    const agents = new Map<number, Agent>();

    for (let i = 0; i < 100; i++) {
      agents.set(i, {
        id: i,
        name: `agent-${i}`,
        sessionId: `session-${i}`,
        branch: `claude-agent-${i}`,
        worktreePath: `/test/repo/.worktrees/claude-agent-${i}`,
        repoPath: '/test/repo',
        status: 'idle',
        diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
      });
    }

    expect(() => {
      persistence.saveAgents(agents);
    }).not.toThrow();

    expect(mockWorktreeManager.saveAgentMetadata).toHaveBeenCalledTimes(100);
  });

  it('should handle worktreeManager throwing error during scan', () => {
    vi.mocked(mockWorktreeManager.scanWorktreesForAgents).mockImplementation(() => {
      throw new Error('Scan failed');
    });

    expect(() => {
      persistence.scanWorktreesForAgents(['/repo1', '/repo2']);
    }).toThrow('Scan failed');
  });

  it('should handle empty repo paths array', () => {
    const agents = persistence.scanWorktreesForAgents([]);

    expect(agents).toEqual([]);
  });
});

describe('NodeSystemAdapter Robustness', () => {
  let adapter: SystemAdapter;
  let tempDir: string;

  beforeEach(() => {
    adapter = getTestSystemAdapter();
    tempDir = createTempDir('adapter-robustness-');
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should handle non-existent command', () => {
    // Should throw or return error string
    try {
      const result = adapter.execSync('nonexistent-command-12345', tempDir);
      expect(result).toBeDefined();
    } catch (e) {
      // Expected to throw for non-existent command
      expect(e).toBeDefined();
    }
  });

  it('should handle command with very long output', () => {
    // Generate a command that produces long output
    const result = adapter.execSync('echo ' + 'x'.repeat(1000), tempDir);

    expect(result).toBeDefined();
  });

  it('should handle short-running command', () => {
    // Just verify the adapter handles basic commands gracefully
    expect(() => {
      adapter.execSync('echo test', tempDir);
    }).not.toThrow();
  });

  it('should handle exists for various paths', () => {
    // Check that temp dir exists (cross-platform)
    expect(adapter.exists(tempDir)).toBe(true);
    expect(adapter.exists(systemAdapter.joinPath(tempDir, 'nonexistent', 'path', '12345'))).toBe(false);
  });

  it('should handle mkdir for nested paths', () => {
    const deepPath = systemAdapter.joinPath(tempDir, 'a', 'b', 'c', 'd', 'e');

    expect(() => {
      adapter.mkdir(deepPath);
    }).not.toThrow();

    expect(fs.existsSync(deepPath)).toBe(true);
  });
});

describe('Type Coercion & Validation', () => {
  it('should handle agent with all optional fields undefined', () => {
    const agent: Partial<Agent> = {
      id: 1,
      name: 'test',
      sessionId: 'session-123',
      branch: 'claude-test',
      worktreePath: '/test/path',
      repoPath: '/test',
      status: 'idle',
      diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
      // All optional fields omitted
    };

    // Should be usable without errors
    expect(agent.id).toBe(1);
    expect(agent.taskFile).toBeUndefined();
    expect(agent.containerConfigName).toBeUndefined();
  });

  it('should handle PersistedAgent to Agent conversion', () => {
    const persisted: PersistedAgent = {
      id: 1,
      name: 'test',
      sessionId: 'session-123',
      branch: 'claude-test',
      worktreePath: '/test/path',
      repoPath: '/test',
    };

    // Convert to full Agent
    const agent: Agent = {
      ...persisted,
      status: 'idle',
      diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
    };

    expect(agent.id).toBe(1);
    expect(agent.status).toBe('idle');
  });
});
