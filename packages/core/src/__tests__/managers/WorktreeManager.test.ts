/**
 * WorktreeManager tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorktreeManager } from '../../managers/WorktreeManager';
import { MockSystemAdapter } from '../mocks/MockSystemAdapter';
import { MockConfigAdapter } from '../mocks/MockConfigAdapter';

describe('WorktreeManager', () => {
  let system: MockSystemAdapter;
  let config: MockConfigAdapter;
  let manager: WorktreeManager;

  beforeEach(() => {
    system = new MockSystemAdapter();
    config = new MockConfigAdapter({
      worktreeDirectory: '.worktrees',
    });
    manager = new WorktreeManager(system, config);
  });

  describe('worktreeExists', () => {
    it('returns true when worktree directory exists', () => {
      system.addDirectory('/repo/.worktrees/claude-alpha');
      expect(manager.worktreeExists('/repo/.worktrees/claude-alpha')).toBe(true);
    });

    it('returns false when worktree directory does not exist', () => {
      expect(manager.worktreeExists('/repo/.worktrees/claude-alpha')).toBe(false);
    });
  });

  describe('getWorktreePath', () => {
    it('returns correct worktree path for agent name', () => {
      const path = manager.getWorktreePath('/repo', 'alpha');
      expect(path).toBe('/repo/.worktrees/claude-alpha');
    });

    it('handles different worktree directories', () => {
      config.setConfig({ worktreeDirectory: 'custom-worktrees' });
      const path = manager.getWorktreePath('/repo', 'bravo');
      expect(path).toBe('/repo/custom-worktrees/claude-bravo');
    });
  });

  describe('saveAgentMetadata', () => {
    it('saves agent metadata to JSON file', () => {
      system.addDirectory('/worktree');

      const agent = {
        id: 1,
        name: 'alpha',
        sessionId: 'abc-123',
        branch: 'claude-alpha',
        worktreePath: '/worktree',
        repoPath: '/repo',
        taskFile: null,
        terminal: null,
        status: 'idle' as const,
        statusIcon: 'circle-outline',
        pendingApproval: null,
        lastInteractionTime: new Date(),
        diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
      };

      manager.saveAgentMetadata(agent);

      const metadataPath = '/worktree/.opus-orchestra/agent.json';
      expect(system.exists(metadataPath)).toBe(true);

      const content = JSON.parse(system.readFile(metadataPath));
      expect(content.id).toBe(1);
      expect(content.name).toBe('alpha');
      expect(content.sessionId).toBe('abc-123');
      expect(content.branch).toBe('claude-alpha');
    });
  });

  describe('loadAgentMetadata', () => {
    it('loads agent metadata from JSON file', () => {
      system.addDirectory('/worktree/.opus-orchestra');
      system.addFile('/worktree/.opus-orchestra/agent.json', JSON.stringify({
        id: 2,
        name: 'bravo',
        sessionId: 'def-456',
        branch: 'claude-bravo',
        worktreePath: '/worktree',
        repoPath: '/repo',
        taskFile: 'feature.md',
      }));

      const result = manager.loadAgentMetadata('/worktree');

      expect(result).not.toBeNull();
      expect(result?.id).toBe(2);
      expect(result?.name).toBe('bravo');
      expect(result?.sessionId).toBe('def-456');
      expect(result?.taskFile).toBe('feature.md');
    });

    it('returns null when metadata file does not exist', () => {
      const result = manager.loadAgentMetadata('/worktree');
      expect(result).toBeNull();
    });

    it('returns null when metadata file is invalid JSON', () => {
      system.addDirectory('/worktree/.opus-orchestra');
      system.addFile('/worktree/.opus-orchestra/agent.json', 'not json');

      const result = manager.loadAgentMetadata('/worktree');
      expect(result).toBeNull();
    });
  });

  describe('scanWorktreesForAgents', () => {
    it('finds agents in worktrees directory', () => {
      // Setup worktrees with metadata
      system.addDirectory('/repo/.worktrees');
      system.addDirectory('/repo/.worktrees/claude-alpha');
      system.addFile('/repo/.worktrees/claude-alpha/.opus-orchestra/agent.json', JSON.stringify({
        id: 1,
        name: 'alpha',
        sessionId: 'abc-123',
        branch: 'claude-alpha',
        worktreePath: '/repo/.worktrees/claude-alpha',
        repoPath: '/repo',
      }));

      system.addDirectory('/repo/.worktrees/claude-bravo');
      system.addFile('/repo/.worktrees/claude-bravo/.opus-orchestra/agent.json', JSON.stringify({
        id: 2,
        name: 'bravo',
        sessionId: 'def-456',
        branch: 'claude-bravo',
        worktreePath: '/repo/.worktrees/claude-bravo',
        repoPath: '/repo',
      }));

      const agents = manager.scanWorktreesForAgents('/repo');

      expect(agents).toHaveLength(2);
      expect(agents.map(a => a.name).sort()).toEqual(['alpha', 'bravo']);
    });

    it('ignores directories without agent metadata', () => {
      system.addDirectory('/repo/.worktrees');
      system.addDirectory('/repo/.worktrees/claude-alpha');
      // No agent.json file

      const agents = manager.scanWorktreesForAgents('/repo');
      expect(agents).toHaveLength(0);
    });

    it('ignores non-agent directories', () => {
      system.addDirectory('/repo/.worktrees');
      system.addDirectory('/repo/.worktrees/random-dir');
      system.addFile('/repo/.worktrees/random-dir/.opus-orchestra/agent.json', JSON.stringify({
        id: 1,
        name: 'alpha',
      }));

      const agents = manager.scanWorktreesForAgents('/repo');
      expect(agents).toHaveLength(0); // 'random-dir' doesn't start with 'claude-'
    });

    it('returns empty array when worktrees directory does not exist', () => {
      const agents = manager.scanWorktreesForAgents('/repo');
      expect(agents).toEqual([]);
    });
  });

  describe('createWorktree', () => {
    it('executes git worktree add command', () => {
      let executedCommand = '';
      const originalExec = system.execSync.bind(system);
      system.execSync = (cmd: string, cwd: string) => {
        executedCommand = cmd;
        return originalExec(cmd, cwd);
      };

      manager.createWorktree('/repo', '/repo/.worktrees/claude-alpha', 'claude-alpha', 'main');

      expect(executedCommand).toContain('git worktree add');
      expect(executedCommand).toContain('claude-alpha');
      expect(executedCommand).toContain('main');
    });
  });

  describe('removeWorktree', () => {
    it('removes worktree directory when git command fails', () => {
      system.addDirectory('/repo/.worktrees/claude-alpha');
      system.setExecError('git worktree remove', new Error('worktree in use'));

      manager.removeWorktree('/repo', '/repo/.worktrees/claude-alpha');

      expect(system.exists('/repo/.worktrees/claude-alpha')).toBe(false);
    });
  });
});
