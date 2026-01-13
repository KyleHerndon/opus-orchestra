/**
 * AgentPersistence tests
 *
 * ARCHITECTURE: Tests worktree-only persistence.
 * All agent state is stored in worktree metadata files only.
 * No central storage is used for agent data.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentPersistence } from '../../managers/AgentPersistence';
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
  let worktreeManager: IWorktreeManager;

  beforeEach(() => {
    worktreeManager = createMockWorktreeManager();
    // ARCHITECTURE: AgentPersistence takes repoPath, not storage
    persistence = new AgentPersistence(worktreeManager, '/repo');
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
    it('saves agent metadata to worktrees only', () => {
      const agents = new Map<number, Agent>();
      const agent1 = createTestAgent({ id: 1, name: 'alpha' });
      const agent2 = createTestAgent({ id: 2, name: 'beta' });
      agents.set(1, agent1);
      agents.set(2, agent2);

      persistence.saveAgents(agents);

      // ARCHITECTURE: Only worktree metadata is saved, no central storage
      expect(worktreeManager.saveAgentMetadata).toHaveBeenCalledTimes(2);
      expect(worktreeManager.saveAgentMetadata).toHaveBeenCalledWith(agent1);
      expect(worktreeManager.saveAgentMetadata).toHaveBeenCalledWith(agent2);
    });

    it('handles empty agent map', () => {
      const agents = new Map<number, Agent>();

      persistence.saveAgents(agents);

      expect(worktreeManager.saveAgentMetadata).not.toHaveBeenCalled();
    });
  });

  describe('loadPersistedAgents', () => {
    it('returns agents from worktree scan', () => {
      const scannedAgents: PersistedAgent[] = [
        { id: 1, name: 'alpha', sessionId: 'sess1', branch: 'alpha', worktreePath: '/repo/.worktrees/alpha', repoPath: '/repo' },
        { id: 2, name: 'beta', sessionId: 'sess2', branch: 'beta', worktreePath: '/repo/.worktrees/beta', repoPath: '/repo' },
      ];
      (worktreeManager.scanWorktreesForAgents as ReturnType<typeof vi.fn>)
        .mockReturnValue(scannedAgents);

      const agents = persistence.loadPersistedAgents();

      // ARCHITECTURE: Agents are loaded from worktree scan, not central storage
      expect(worktreeManager.scanWorktreesForAgents).toHaveBeenCalledWith('/repo');
      expect(agents.length).toBe(2);
      expect(agents[0].name).toBe('alpha');
      expect(agents[1].name).toBe('beta');
    });

    it('returns empty array when no worktrees found', () => {
      (worktreeManager.scanWorktreesForAgents as ReturnType<typeof vi.fn>)
        .mockReturnValue([]);

      const agents = persistence.loadPersistedAgents();

      expect(agents).toEqual([]);
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
});
