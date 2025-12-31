/**
 * AgentPersistence tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentPersistence } from '../../managers/AgentPersistence';
import { MockStorageAdapter } from '../mocks/MockStorageAdapter';
import { IWorktreeManager } from '../../managers/WorktreeManager';
import { Agent, PersistedAgent } from '../../types/agent';

// Mock WorktreeManager
function createMockWorktreeManager(): IWorktreeManager {
  return {
    saveAgentMetadata: vi.fn(),
    loadAgentMetadata: vi.fn(),
    scanWorktreesForAgents: vi.fn().mockReturnValue([]),
    worktreeExists: vi.fn().mockReturnValue(true),
    getWorktreePath: vi.fn((repoPath, name) => `${repoPath}/.worktrees/${name}`),
    createWorktree: vi.fn(),
    removeWorktree: vi.fn(),
    renameWorktree: vi.fn(),
    copyCoordinationFiles: vi.fn(),
  };
}

function createTestAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 1,
    name: 'claude-alpha',
    sessionId: 'test-session-123',
    branch: 'claude-alpha',
    worktreePath: '/repo/.worktrees/claude-alpha',
    repoPath: '/repo',
    taskFile: undefined,
    containerConfigName: 'unisolated',
    status: 'idle',
    diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
    sessionStarted: false,
    isTerminalAlive: false,
    ...overrides,
  };
}

describe('AgentPersistence', () => {
  let persistence: AgentPersistence;
  let storage: MockStorageAdapter;
  let worktreeManager: IWorktreeManager;

  beforeEach(() => {
    storage = new MockStorageAdapter();
    worktreeManager = createMockWorktreeManager();
    persistence = new AgentPersistence(worktreeManager, storage);
  });

  describe('generateSessionId', () => {
    it('generates valid UUID v4 format', () => {
      const sessionId = persistence.generateSessionId();

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      expect(sessionId).toMatch(uuidRegex);
    });

    it('generates unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(persistence.generateSessionId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('saveAgents', () => {
    it('saves agents to storage', async () => {
      const agents = new Map<number, Agent>();
      agents.set(1, createTestAgent({ id: 1, name: 'alpha' }));
      agents.set(2, createTestAgent({ id: 2, name: 'beta' }));

      persistence.saveAgents(agents);

      const saved = storage.get<PersistedAgent[]>('opus.agents', []);
      expect(saved.length).toBe(2);
      expect(saved.map(a => a.name)).toContain('alpha');
      expect(saved.map(a => a.name)).toContain('beta');
    });

    it('saves agent metadata to worktrees', () => {
      const agent = createTestAgent();
      const agents = new Map<number, Agent>();
      agents.set(1, agent);

      persistence.saveAgents(agents);

      expect(worktreeManager.saveAgentMetadata).toHaveBeenCalledWith(agent);
    });

    it('persists correct fields', async () => {
      const agent = createTestAgent({
        id: 42,
        name: 'test-agent',
        sessionId: 'session-abc',
        branch: 'feature-branch',
        worktreePath: '/repo/.worktrees/test',
        repoPath: '/repo',
        taskFile: 'task.md',
        containerConfigName: 'docker',
        sessionStarted: true,
      });
      const agents = new Map<number, Agent>();
      agents.set(42, agent);

      persistence.saveAgents(agents);

      const saved = storage.get<PersistedAgent[]>('opus.agents', []);
      expect(saved[0]).toEqual({
        id: 42,
        name: 'test-agent',
        sessionId: 'session-abc',
        branch: 'feature-branch',
        worktreePath: '/repo/.worktrees/test',
        repoPath: '/repo',
        taskFile: 'task.md',
        containerConfigName: 'docker',
        sessionStarted: true,
      });
    });
  });

  describe('loadPersistedAgents', () => {
    it('returns empty array when no agents saved', () => {
      const agents = persistence.loadPersistedAgents();
      expect(agents).toEqual([]);
    });

    it('returns saved agents', async () => {
      const savedAgents: PersistedAgent[] = [
        { id: 1, name: 'alpha', sessionId: 'sess1', branch: 'alpha', worktreePath: '/repo/.worktrees/alpha', repoPath: '/repo' },
        { id: 2, name: 'beta', sessionId: 'sess2', branch: 'beta', worktreePath: '/repo/.worktrees/beta', repoPath: '/repo' },
      ];
      await storage.set('opus.agents', savedAgents);

      const agents = persistence.loadPersistedAgents();

      expect(agents.length).toBe(2);
      expect(agents[0].name).toBe('alpha');
      expect(agents[1].name).toBe('beta');
    });
  });

  describe('scanWorktreesForAgents', () => {
    it('scans all provided repo paths', () => {
      const repoPaths = ['/repo1', '/repo2', '/repo3'];

      persistence.scanWorktreesForAgents(repoPaths);

      expect(worktreeManager.scanWorktreesForAgents).toHaveBeenCalledWith('/repo1');
      expect(worktreeManager.scanWorktreesForAgents).toHaveBeenCalledWith('/repo2');
      expect(worktreeManager.scanWorktreesForAgents).toHaveBeenCalledWith('/repo3');
    });

    it('returns combined agents from all repos', () => {
      const repo1Agents: PersistedAgent[] = [
        { id: 1, name: 'alpha', sessionId: 's1', branch: 'alpha', worktreePath: '/repo1/.worktrees/alpha', repoPath: '/repo1' },
      ];
      const repo2Agents: PersistedAgent[] = [
        { id: 2, name: 'beta', sessionId: 's2', branch: 'beta', worktreePath: '/repo2/.worktrees/beta', repoPath: '/repo2' },
      ];

      (worktreeManager.scanWorktreesForAgents as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(repo1Agents)
        .mockReturnValueOnce(repo2Agents);

      const agents = persistence.scanWorktreesForAgents(['/repo1', '/repo2']);

      expect(agents.length).toBe(2);
      expect(agents.map(a => a.name)).toContain('alpha');
      expect(agents.map(a => a.name)).toContain('beta');
    });

    it('returns empty array when no repos provided', () => {
      const agents = persistence.scanWorktreesForAgents([]);
      expect(agents).toEqual([]);
    });
  });

  describe('mergeAgentSources', () => {
    it('worktree agents override storage agents', () => {
      const worktreeAgents = new Map<string, PersistedAgent>();
      worktreeAgents.set('/repo/.worktrees/alpha', {
        id: 1,
        name: 'alpha-worktree',
        sessionId: 'worktree-session',
        branch: 'alpha',
        worktreePath: '/repo/.worktrees/alpha',
        repoPath: '/repo',
      });

      const storageAgents: PersistedAgent[] = [
        {
          id: 1,
          name: 'alpha-storage',
          sessionId: 'storage-session',
          branch: 'alpha',
          worktreePath: '/repo/.worktrees/alpha',
          repoPath: '/repo',
        },
      ];

      const merged = persistence.mergeAgentSources(worktreeAgents, storageAgents);

      const agent = merged.get('/repo/.worktrees/alpha');
      expect(agent?.name).toBe('alpha-worktree');
      expect(agent?.sessionId).toBe('worktree-session');
    });

    it('includes storage-only agents', () => {
      const worktreeAgents = new Map<string, PersistedAgent>();
      const storageAgents: PersistedAgent[] = [
        {
          id: 1,
          name: 'storage-only',
          sessionId: 'sess1',
          branch: 'alpha',
          worktreePath: '/repo/.worktrees/alpha',
          repoPath: '/repo',
        },
      ];

      const merged = persistence.mergeAgentSources(worktreeAgents, storageAgents);

      expect(merged.has('/repo/.worktrees/alpha')).toBe(true);
      expect(merged.get('/repo/.worktrees/alpha')?.name).toBe('storage-only');
    });

    it('includes worktree-only agents', () => {
      const worktreeAgents = new Map<string, PersistedAgent>();
      worktreeAgents.set('/repo/.worktrees/alpha', {
        id: 1,
        name: 'worktree-only',
        sessionId: 'sess1',
        branch: 'alpha',
        worktreePath: '/repo/.worktrees/alpha',
        repoPath: '/repo',
      });

      const merged = persistence.mergeAgentSources(worktreeAgents, []);

      expect(merged.has('/repo/.worktrees/alpha')).toBe(true);
      expect(merged.get('/repo/.worktrees/alpha')?.name).toBe('worktree-only');
    });
  });

  describe('agent order management', () => {
    describe('getAgentOrder', () => {
      it('returns empty array for repo with no order', () => {
        const order = persistence.getAgentOrder('/repo');
        expect(order).toEqual([]);
      });

      it('returns saved order', async () => {
        await storage.set('opus.agentOrder', { '/repo': [3, 1, 2] });

        const order = persistence.getAgentOrder('/repo');
        expect(order).toEqual([3, 1, 2]);
      });
    });

    describe('setAgentOrder', () => {
      it('saves order for repo', async () => {
        persistence.setAgentOrder('/repo', [2, 1, 3]);

        const orderMap = storage.get<Record<string, number[]>>('opus.agentOrder', {});
        expect(orderMap['/repo']).toEqual([2, 1, 3]);
      });

      it('preserves order for other repos', async () => {
        await storage.set('opus.agentOrder', { '/repo1': [1, 2] });

        persistence.setAgentOrder('/repo2', [3, 4]);

        const orderMap = storage.get<Record<string, number[]>>('opus.agentOrder', {});
        expect(orderMap['/repo1']).toEqual([1, 2]);
        expect(orderMap['/repo2']).toEqual([3, 4]);
      });
    });

    describe('removeAgentFromOrder', () => {
      it('removes agent from order', async () => {
        await storage.set('opus.agentOrder', { '/repo': [1, 2, 3] });

        persistence.removeAgentFromOrder(2, '/repo');

        const order = persistence.getAgentOrder('/repo');
        expect(order).toEqual([1, 3]);
      });

      it('removes repo key when order becomes empty', async () => {
        await storage.set('opus.agentOrder', { '/repo': [1] });

        persistence.removeAgentFromOrder(1, '/repo');

        const orderMap = storage.get<Record<string, number[]>>('opus.agentOrder', {});
        expect(orderMap['/repo']).toBeUndefined();
      });

      it('handles non-existent repo', () => {
        // Should not throw
        expect(() => {
          persistence.removeAgentFromOrder(1, '/nonexistent');
        }).not.toThrow();
      });

      it('handles non-existent agent in order', async () => {
        await storage.set('opus.agentOrder', { '/repo': [1, 2] });

        persistence.removeAgentFromOrder(99, '/repo');

        const order = persistence.getAgentOrder('/repo');
        expect(order).toEqual([1, 2]);
      });
    });
  });
});
