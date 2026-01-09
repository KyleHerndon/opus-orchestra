/**
 * Tests for type definitions
 */

import { describe, it, expect } from 'vitest';
import type {
  TerminalAgent,
  DashboardStats,
  TodoItem,
  ViewType,
} from '../types.js';

describe('Types', () => {
  describe('TerminalAgent', () => {
    it('should accept valid agent data', () => {
      const agent: TerminalAgent = {
        id: 1,
        name: 'alpha',
        status: 'working',
        repoPath: '/path/to/repo',
        branch: 'claude-alpha',
        diffStats: {
          insertions: 10,
          deletions: 5,
          filesChanged: 3,
        },
        todos: [],
        lastInteractionTime: new Date(),
      };

      expect(agent.id).toBe(1);
      expect(agent.name).toBe('alpha');
      expect(agent.status).toBe('working');
    });

    it('should accept agent with optional fields', () => {
      const agent: TerminalAgent = {
        id: 2,
        name: 'bravo',
        status: 'waiting-approval',
        repoPath: '/path/to/repo',
        branch: 'claude-bravo',
        diffStats: {
          insertions: 0,
          deletions: 0,
          filesChanged: 0,
        },
        containerConfigName: 'docker',
        pendingApproval: 'Write to file',
        todos: [
          { status: 'in_progress', content: 'Task 1' },
        ],
        lastInteractionTime: new Date(),
      };

      expect(agent.containerConfigName).toBe('docker');
      expect(agent.pendingApproval).toBe('Write to file');
      expect(agent.todos).toHaveLength(1);
    });
  });

  describe('DashboardStats', () => {
    it('should accept valid stats data', () => {
      const stats: DashboardStats = {
        total: 5,
        working: 2,
        waiting: 1,
        containerized: 3,
        totalInsertions: 100,
        totalDeletions: 50,
      };

      expect(stats.total).toBe(5);
      expect(stats.working).toBe(2);
      expect(stats.containerized).toBe(3);
    });
  });

  describe('TodoItem', () => {
    it('should accept all valid statuses', () => {
      const pending: TodoItem = { status: 'pending', content: 'Pending task' };
      const inProgress: TodoItem = { status: 'in_progress', content: 'In progress' };
      const completed: TodoItem = { status: 'completed', content: 'Done' };

      expect(pending.status).toBe('pending');
      expect(inProgress.status).toBe('in_progress');
      expect(completed.status).toBe('completed');
    });
  });

  describe('ViewType', () => {
    it('should accept all valid view types', () => {
      const views: ViewType[] = ['agents', 'diff', 'settings', 'help'];

      expect(views).toContain('agents');
      expect(views).toContain('diff');
      expect(views).toContain('settings');
      expect(views).toContain('help');
    });
  });
});
