/**
 * Tests for TmuxTerminalAdapter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TmuxTerminalAdapter } from '../adapters/TmuxTerminalAdapter.js';
import { MockSystemAdapter } from './fixtures/mockAdapters.js';

describe('TmuxTerminalAdapter', () => {
  let adapter: TmuxTerminalAdapter;
  let mockSystem: MockSystemAdapter;

  beforeEach(() => {
    mockSystem = new MockSystemAdapter();
    adapter = new TmuxTerminalAdapter(mockSystem);
  });

  describe('createTerminal', () => {
    it('should create a terminal with unique id', () => {
      const terminal = adapter.createTerminal({ name: 'test-agent' });

      expect(terminal.id).toMatch(/^terminal-\d+$/);
      expect(terminal.name).toBe('test-agent');
    });

    it('should sanitize session name for tmux', () => {
      const terminal = adapter.createTerminal({ name: 'test agent with spaces!' });

      // The adapter should have called exec with a sanitized session name
      const execCalls = mockSystem.calls.filter(c => c.method === 'exec');
      expect(execCalls.length).toBeGreaterThan(0);

      // Check the command uses sanitized name (spaces replaced with dashes)
      const cmd = execCalls[0].args[0] as string;
      expect(cmd).toContain('tmux new-session');
      expect(cmd).toContain('test-agent-with-spaces-');
    });

    it('should create tmux session with cwd', () => {
      adapter.createTerminal({ name: 'alpha', cwd: '/path/to/repo' });

      const execCalls = mockSystem.calls.filter(c => c.method === 'exec');
      expect(execCalls.length).toBeGreaterThan(0);

      const cmd = execCalls[0].args[0] as string;
      expect(cmd).toContain('/path/to/repo');
    });

    it('should create multiple terminals with unique ids', () => {
      const t1 = adapter.createTerminal({ name: 'alpha' });
      const t2 = adapter.createTerminal({ name: 'bravo' });
      const t3 = adapter.createTerminal({ name: 'charlie' });

      expect(t1.id).not.toBe(t2.id);
      expect(t2.id).not.toBe(t3.id);
      expect(t1.id).not.toBe(t3.id);
    });
  });

  describe('sendText', () => {
    it('should send text to tmux session with newline', () => {
      const terminal = adapter.createTerminal({ name: 'test' });
      mockSystem.calls = []; // Clear previous calls

      adapter.sendText(terminal, 'echo hello');

      const execCalls = mockSystem.calls.filter(c => c.method === 'exec');
      expect(execCalls.length).toBe(1);

      const cmd = execCalls[0].args[0] as string;
      expect(cmd).toContain('tmux send-keys');
      expect(cmd).toContain('echo hello');
      expect(cmd).toContain('Enter');
    });

    it('should send text without newline when specified', () => {
      const terminal = adapter.createTerminal({ name: 'test' });
      mockSystem.calls = [];

      adapter.sendText(terminal, 'partial', false);

      const execCalls = mockSystem.calls.filter(c => c.method === 'exec');
      const cmd = execCalls[0].args[0] as string;
      expect(cmd).not.toContain('Enter');
    });

    it('should escape quotes in text', () => {
      const terminal = adapter.createTerminal({ name: 'test' });
      mockSystem.calls = [];

      adapter.sendText(terminal, 'echo "hello world"');

      const execCalls = mockSystem.calls.filter(c => c.method === 'exec');
      const cmd = execCalls[0].args[0] as string;
      expect(cmd).toContain('\\"hello world\\"');
    });

    it('should not send text to disposed terminal', () => {
      const terminal = adapter.createTerminal({ name: 'test' });
      adapter.dispose(terminal);
      mockSystem.calls = [];

      adapter.sendText(terminal, 'echo hello');

      const execCalls = mockSystem.calls.filter(c => c.method === 'exec');
      // Should not have any send-keys calls (only kill-session from dispose)
      expect(execCalls.filter(c => (c.args[0] as string).includes('send-keys'))).toHaveLength(0);
    });
  });

  describe('dispose', () => {
    it('should kill tmux session on dispose', () => {
      const terminal = adapter.createTerminal({ name: 'test' });
      mockSystem.calls = [];

      adapter.dispose(terminal);

      const execCalls = mockSystem.calls.filter(c => c.method === 'exec');
      expect(execCalls.length).toBe(1);

      const cmd = execCalls[0].args[0] as string;
      expect(cmd).toContain('tmux kill-session');
    });

    it('should notify close callbacks', () => {
      const terminal = adapter.createTerminal({ name: 'test' });
      let closedTerminal: unknown = null;

      adapter.onDidClose((t) => {
        closedTerminal = t;
      });

      adapter.dispose(terminal);

      expect(closedTerminal).toBe(terminal);
    });

    it('should remove terminal from internal map', () => {
      const terminal = adapter.createTerminal({ name: 'test' });
      expect(adapter.isAlive(terminal)).toBe(true);

      adapter.dispose(terminal);

      expect(adapter.isAlive(terminal)).toBe(false);
    });
  });

  describe('findByName', () => {
    it('should find terminal by name', () => {
      const t1 = adapter.createTerminal({ name: 'alpha' });
      adapter.createTerminal({ name: 'bravo' });

      const found = adapter.findByName('alpha');
      expect(found).toBe(t1);
    });

    it('should return undefined for unknown name', () => {
      adapter.createTerminal({ name: 'alpha' });

      const found = adapter.findByName('unknown');
      expect(found).toBeUndefined();
    });
  });

  describe('isAlive', () => {
    it('should return true for active terminal', () => {
      const terminal = adapter.createTerminal({ name: 'test' });
      expect(adapter.isAlive(terminal)).toBe(true);
    });

    it('should return false for disposed terminal', () => {
      const terminal = adapter.createTerminal({ name: 'test' });
      adapter.dispose(terminal);
      expect(adapter.isAlive(terminal)).toBe(false);
    });

    it('should return false for unknown terminal', () => {
      const fakeTerminal = { id: 'fake', name: 'fake' };
      expect(adapter.isAlive(fakeTerminal)).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return all active terminals', () => {
      const t1 = adapter.createTerminal({ name: 'alpha' });
      const t2 = adapter.createTerminal({ name: 'bravo' });
      const t3 = adapter.createTerminal({ name: 'charlie' });

      const all = adapter.getAll();
      expect(all).toHaveLength(3);
      expect(all).toContain(t1);
      expect(all).toContain(t2);
      expect(all).toContain(t3);
    });

    it('should not include disposed terminals', () => {
      const t1 = adapter.createTerminal({ name: 'alpha' });
      const t2 = adapter.createTerminal({ name: 'bravo' });

      adapter.dispose(t1);

      const all = adapter.getAll();
      expect(all).toHaveLength(1);
      expect(all).toContain(t2);
    });

    it('should return empty array when no terminals', () => {
      const all = adapter.getAll();
      expect(all).toEqual([]);
    });
  });

  describe('onDidClose', () => {
    it('should register callback', () => {
      const callback = vi.fn();
      const unsubscribe = adapter.onDidClose(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('should call callback on terminal close', () => {
      const callback = vi.fn();
      adapter.onDidClose(callback);

      const terminal = adapter.createTerminal({ name: 'test' });
      adapter.dispose(terminal);

      expect(callback).toHaveBeenCalledWith(terminal);
    });

    it('should allow unsubscribe', () => {
      const callback = vi.fn();
      const unsubscribe = adapter.onDidClose(callback);
      unsubscribe();

      const terminal = adapter.createTerminal({ name: 'test' });
      adapter.dispose(terminal);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('sessionExists', () => {
    it('should return true when session exists', async () => {
      mockSystem.execResponses.set('tmux has-session', '');

      const exists = await adapter.sessionExists('test-session');
      expect(exists).toBe(true);
    });

    it('should return false when session does not exist', async () => {
      mockSystem.execErrors.set('tmux has-session', new Error('session not found'));

      const exists = await adapter.sessionExists('nonexistent');
      expect(exists).toBe(false);
    });
  });
});

// Import vi for function mocking
import { vi } from 'vitest';
