/**
 * StatusService integration tests
 *
 * Tests StatusService with real file system operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { StatusService } from '../../services/StatusService';
import { SystemAdapter } from '../../adapters/SystemAdapter';
import { createTempDir, TestRepo, getTestSystemAdapter } from '../fixtures/testRepo';

describe('StatusService', () => {
  let tempDir: TestRepo;
  let system: SystemAdapter;
  let status: StatusService;

  beforeEach(() => {
    tempDir = createTempDir('status-service-test-');
    system = getTestSystemAdapter();
    status = new StatusService(system);
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  describe('getStatusDirectory', () => {
    it('returns correct status directory path', () => {
      const result = status.getStatusDirectory(tempDir.path);
      expect(result).toBe(path.join(tempDir.path, '.opus-orchestra', 'status'));
    });
  });

  describe('checkStatus', () => {
    it('returns null when status directory does not exist', () => {
      const result = status.checkStatus(tempDir.path);
      expect(result).toBeNull();
    });

    it('returns null when status directory is empty', () => {
      const statusDir = path.join(tempDir.path, '.opus-orchestra', 'status');
      fs.mkdirSync(statusDir, { recursive: true });

      const result = status.checkStatus(tempDir.path);
      expect(result).toBeNull();
    });

    it('parses JSON hook data with tool_name as waiting-approval', () => {
      const statusDir = path.join(tempDir.path, '.opus-orchestra', 'status');
      fs.mkdirSync(statusDir, { recursive: true });

      const hookData = {
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
      };
      fs.writeFileSync(
        path.join(statusDir, 'session-123'),
        JSON.stringify(hookData)
      );

      const result = status.checkStatus(tempDir.path);

      expect(result).not.toBeNull();
      expect(result?.status).toBe('waiting-approval');
      expect(result?.pendingApproval).toBe('Bash: npm test');
    });

    it('parses JSON hook data with session_id as working', () => {
      const statusDir = path.join(tempDir.path, '.opus-orchestra', 'status');
      fs.mkdirSync(statusDir, { recursive: true });

      const hookData = {
        session_id: 'abc-123',
      };
      fs.writeFileSync(
        path.join(statusDir, 'session-123'),
        JSON.stringify(hookData)
      );

      const result = status.checkStatus(tempDir.path);

      expect(result).not.toBeNull();
      expect(result?.status).toBe('working');
      expect(result?.pendingApproval).toBeNull();
    });

    it('parses Write tool with file_path context', () => {
      const statusDir = path.join(tempDir.path, '.opus-orchestra', 'status');
      fs.mkdirSync(statusDir, { recursive: true });

      const hookData = {
        tool_name: 'Write',
        tool_input: { file_path: '/src/index.ts' },
      };
      fs.writeFileSync(
        path.join(statusDir, 'session-123'),
        JSON.stringify(hookData)
      );

      const result = status.checkStatus(tempDir.path);

      expect(result?.status).toBe('waiting-approval');
      expect(result?.pendingApproval).toBe('Write: /src/index.ts');
    });

    it('parses Edit tool with file_path context', () => {
      const statusDir = path.join(tempDir.path, '.opus-orchestra', 'status');
      fs.mkdirSync(statusDir, { recursive: true });

      const hookData = {
        tool_name: 'Edit',
        tool_input: { file_path: '/src/utils.ts' },
      };
      fs.writeFileSync(
        path.join(statusDir, 'session-123'),
        JSON.stringify(hookData)
      );

      const result = status.checkStatus(tempDir.path);

      expect(result?.status).toBe('waiting-approval');
      expect(result?.pendingApproval).toBe('Edit: /src/utils.ts');
    });

    it('handles tool without context', () => {
      const statusDir = path.join(tempDir.path, '.opus-orchestra', 'status');
      fs.mkdirSync(statusDir, { recursive: true });

      const hookData = {
        tool_name: 'UnknownTool',
      };
      fs.writeFileSync(
        path.join(statusDir, 'session-123'),
        JSON.stringify(hookData)
      );

      const result = status.checkStatus(tempDir.path);

      expect(result?.status).toBe('waiting-approval');
      expect(result?.pendingApproval).toBe('UnknownTool');
    });

    it('reads most recent status file when multiple exist', async () => {
      const statusDir = path.join(tempDir.path, '.opus-orchestra', 'status');
      fs.mkdirSync(statusDir, { recursive: true });

      // Create older file
      fs.writeFileSync(
        path.join(statusDir, 'old-session'),
        JSON.stringify({ tool_name: 'OldTool' })
      );

      // Wait a bit to ensure different mtime
      await new Promise(resolve => setTimeout(resolve, 50));

      // Create newer file
      fs.writeFileSync(
        path.join(statusDir, 'new-session'),
        JSON.stringify({ tool_name: 'NewTool' })
      );

      const result = status.checkStatus(tempDir.path);

      expect(result?.pendingApproval).toBe('NewTool');
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
      expect(status.parseHookData('WORKING')).toEqual({
        status: 'working',
        pendingApproval: null,
      });
      expect(status.parseHookData('Working')).toEqual({
        status: 'working',
        pendingApproval: null,
      });
    });
  });

  describe('clearStatus', () => {
    it('removes all files in status directory', () => {
      const statusDir = path.join(tempDir.path, '.opus-orchestra', 'status');
      fs.mkdirSync(statusDir, { recursive: true });
      fs.writeFileSync(path.join(statusDir, 'session-1'), 'content1');
      fs.writeFileSync(path.join(statusDir, 'session-2'), 'content2');

      status.clearStatus(tempDir.path);

      expect(fs.existsSync(path.join(statusDir, 'session-1'))).toBe(false);
      expect(fs.existsSync(path.join(statusDir, 'session-2'))).toBe(false);
    });

    it('handles non-existent status directory gracefully', () => {
      // Should not throw
      expect(() => status.clearStatus(tempDir.path)).not.toThrow();
    });
  });

});
