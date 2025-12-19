/**
 * StatusService tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StatusService } from '../../services/StatusService';
import { MockSystemAdapter } from '../mocks/MockSystemAdapter';

describe('StatusService', () => {
  let system: MockSystemAdapter;
  let status: StatusService;

  beforeEach(() => {
    system = new MockSystemAdapter();
    status = new StatusService(system);
  });

  describe('getStatusDirectory', () => {
    it('returns correct status directory path', () => {
      const result = status.getStatusDirectory('/worktree');
      expect(result).toBe('/worktree/.opus-orchestra/status');
    });
  });

  describe('checkStatus', () => {
    it('returns null when status directory does not exist', () => {
      const result = status.checkStatus('/worktree');
      expect(result).toBeNull();
    });

    it('returns null when status directory is empty', () => {
      system.addDirectory('/worktree/.opus-orchestra/status');
      const result = status.checkStatus('/worktree');
      expect(result).toBeNull();
    });

    it('parses JSON hook data with tool_name as waiting-approval', () => {
      system.addDirectory('/worktree/.opus-orchestra/status');
      system.addFile('/worktree/.opus-orchestra/status/session-123', JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
      }));

      const result = status.checkStatus('/worktree');

      expect(result).toEqual({
        status: 'waiting-approval',
        pendingApproval: 'Bash: npm test',
        fileTimestamp: expect.any(Number),
      });
    });

    it('parses JSON hook data with session_id as working', () => {
      system.addDirectory('/worktree/.opus-orchestra/status');
      system.addFile('/worktree/.opus-orchestra/status/session-123', JSON.stringify({
        session_id: 'abc-123',
      }));

      const result = status.checkStatus('/worktree');

      expect(result).toEqual({
        status: 'working',
        pendingApproval: null,
        fileTimestamp: expect.any(Number),
      });
    });

    it('parses Write tool with file_path context', () => {
      system.addDirectory('/worktree/.opus-orchestra/status');
      system.addFile('/worktree/.opus-orchestra/status/session-123', JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: '/src/index.ts' },
      }));

      const result = status.checkStatus('/worktree');

      expect(result).toEqual({
        status: 'waiting-approval',
        pendingApproval: 'Write: /src/index.ts',
        fileTimestamp: expect.any(Number),
      });
    });

    it('parses Edit tool with file_path context', () => {
      system.addDirectory('/worktree/.opus-orchestra/status');
      system.addFile('/worktree/.opus-orchestra/status/session-123', JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: '/src/utils.ts' },
      }));

      const result = status.checkStatus('/worktree');

      expect(result).toEqual({
        status: 'waiting-approval',
        pendingApproval: 'Edit: /src/utils.ts',
        fileTimestamp: expect.any(Number),
      });
    });

    it('handles tool without context', () => {
      system.addDirectory('/worktree/.opus-orchestra/status');
      system.addFile('/worktree/.opus-orchestra/status/session-123', JSON.stringify({
        tool_name: 'UnknownTool',
      }));

      const result = status.checkStatus('/worktree');

      expect(result).toEqual({
        status: 'waiting-approval',
        pendingApproval: 'UnknownTool',
        fileTimestamp: expect.any(Number),
      });
    });
  });

  describe('parseHookData', () => {
    it('parses legacy "working" status', () => {
      const result = status.parseHookData('working');
      expect(result).toEqual({ status: 'working', pendingApproval: null });
    });

    it('parses legacy "waiting" status as waiting-input', () => {
      const result = status.parseHookData('waiting');
      expect(result).toEqual({ status: 'waiting-input', pendingApproval: null });
    });

    it('parses legacy "stopped" status', () => {
      const result = status.parseHookData('stopped');
      expect(result).toEqual({ status: 'stopped', pendingApproval: null });
    });

    it('returns null for unknown legacy status', () => {
      const result = status.parseHookData('unknown');
      expect(result).toBeNull();
    });

    it('is case-insensitive for legacy status', () => {
      expect(status.parseHookData('WORKING')).toEqual({ status: 'working', pendingApproval: null });
      expect(status.parseHookData('Working')).toEqual({ status: 'working', pendingApproval: null });
    });
  });

  describe('clearStatus', () => {
    it('removes all files in status directory', () => {
      system.addDirectory('/worktree/.opus-orchestra/status');
      system.addFile('/worktree/.opus-orchestra/status/session-1', 'content1');
      system.addFile('/worktree/.opus-orchestra/status/session-2', 'content2');

      status.clearStatus('/worktree');

      expect(system.exists('/worktree/.opus-orchestra/status/session-1')).toBe(false);
      expect(system.exists('/worktree/.opus-orchestra/status/session-2')).toBe(false);
    });

    it('handles non-existent status directory gracefully', () => {
      // Should not throw
      expect(() => status.clearStatus('/worktree')).not.toThrow();
    });
  });
});
