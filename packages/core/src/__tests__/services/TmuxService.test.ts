/**
 * TmuxService integration tests
 *
 * Tests TmuxService with real tmux sessions.
 * Tests are skipped if tmux is not available.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TmuxService } from '../../services/TmuxService';
import { NodeSystemAdapter } from '../../adapters/NodeSystemAdapter';

describe('TmuxService', () => {
  let tmux: TmuxService;
  let system: NodeSystemAdapter;
  let testSessionName: string;
  let createdSessions: string[] = [];

  beforeEach(() => {
    system = new NodeSystemAdapter('bash');
    tmux = new TmuxService(system, 'opus-test');
    testSessionName = `opus-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createdSessions = [];
  });

  afterEach(() => {
    // Clean up all sessions we created
    for (const session of createdSessions) {
      try {
        tmux.killSession(session);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  function createSession(name: string): void {
    tmux.createDetachedSession(name, '/tmp');
    createdSessions.push(name);
  }

  function skipIfNoTmux(): boolean {
    if (!tmux.isTmuxAvailable()) {
      console.log('Skipping: tmux not available');
      return true;
    }
    return false;
  }

  describe('isTmuxAvailable', () => {
    it('returns a boolean indicating tmux availability', () => {
      const available = tmux.isTmuxAvailable();
      expect(typeof available).toBe('boolean');
    });

    it('caches the result after first check', () => {
      const first = tmux.isTmuxAvailable();
      const second = tmux.isTmuxAvailable();
      const third = tmux.isTmuxAvailable();

      expect(first).toBe(second);
      expect(second).toBe(third);
    });
  });

  describe('getSessionName', () => {
    it('formats session name with prefix and truncated UUID', () => {
      const sessionId = 'abc12345-6789-0def-ghij-klmnopqrstuv';
      const name = tmux.getSessionName(sessionId);

      expect(name).toBe('opus-test-abc123456789');
    });

    it('removes dashes from UUID', () => {
      const sessionId = 'aaaa-bbbb-cccc-dddd';
      const name = tmux.getSessionName(sessionId);

      expect(name).toBe('opus-test-aaaabbbbcccc');
    });

    it('uses configured prefix', () => {
      const customTmux = new TmuxService(system, 'myprefix');
      const name = customTmux.getSessionName('abc123456789');

      expect(name).toBe('myprefix-abc123456789');
    });
  });

  describe('getOoAliasCommand', () => {
    it('generates correct alias command', () => {
      const alias = tmux.getOoAliasCommand('claude', 'session-123');

      expect(alias).toBe('alias oo=\'claude --session-id "session-123"\'');
    });

    it('works with custom claude command path', () => {
      const alias = tmux.getOoAliasCommand('/usr/local/bin/claude', 'abc');

      expect(alias).toBe('alias oo=\'/usr/local/bin/claude --session-id "abc"\'');
    });
  });

  describe('setSessionPrefix', () => {
    it('updates the session prefix for future session names', () => {
      const customTmux = new TmuxService(system, 'original');
      expect(customTmux.getSessionName('abc123456789')).toBe('original-abc123456789');

      customTmux.setSessionPrefix('newprefix');
      expect(customTmux.getSessionName('abc123456789')).toBe('newprefix-abc123456789');
    });
  });

  describe('sessionExists', () => {
    it('returns false for non-existent session', function() {
      if (skipIfNoTmux()) return;

      expect(tmux.sessionExists('definitely-not-a-real-session-12345')).toBe(false);
    });

    it('returns true for existing session', function() {
      if (skipIfNoTmux()) return;

      createSession(testSessionName);
      expect(tmux.sessionExists(testSessionName)).toBe(true);
    });
  });

  describe('createDetachedSession', () => {
    it('creates a new detached session', function() {
      if (skipIfNoTmux()) return;

      expect(tmux.sessionExists(testSessionName)).toBe(false);

      createSession(testSessionName);

      expect(tmux.sessionExists(testSessionName)).toBe(true);
    });

    it('is idempotent - calling multiple times does not error', function() {
      if (skipIfNoTmux()) return;

      createSession(testSessionName);

      // Call again - should not throw
      expect(() => {
        tmux.createDetachedSession(testSessionName, '/tmp');
      }).not.toThrow();

      expect(tmux.sessionExists(testSessionName)).toBe(true);
    });

    it('does not use -A flag which causes terminal issues in non-interactive contexts', function() {
      if (skipIfNoTmux()) return;

      // This is the key fix - createDetachedSession should work even when
      // called from a non-terminal context (like a Node.js script)
      // The old implementation with -A flag would fail with "open terminal failed"

      // If we get here without throwing, the fix is working
      createSession(testSessionName);
      expect(tmux.sessionExists(testSessionName)).toBe(true);
    });
  });

  describe('killSession', () => {
    it('kills an existing session', function() {
      if (skipIfNoTmux()) return;

      createSession(testSessionName);
      expect(tmux.sessionExists(testSessionName)).toBe(true);

      tmux.killSession(testSessionName);
      // Remove from cleanup list since we killed it manually
      createdSessions = createdSessions.filter(s => s !== testSessionName);

      expect(tmux.sessionExists(testSessionName)).toBe(false);
    });

    it('does not throw for non-existent session', function() {
      if (skipIfNoTmux()) return;

      expect(() => {
        tmux.killSession('definitely-not-a-real-session-12345');
      }).not.toThrow();
    });
  });

  describe('listSessions', () => {
    it('returns empty array when no sessions exist with prefix', function() {
      if (skipIfNoTmux()) return;

      // Use a unique prefix that definitely has no sessions
      const uniqueTmux = new TmuxService(system, `unique-prefix-${Date.now()}`);
      const sessions = uniqueTmux.listSessions();

      expect(sessions).toEqual([]);
    });

    it('lists sessions with matching prefix', function() {
      if (skipIfNoTmux()) return;

      createSession(testSessionName);

      const sessions = tmux.listSessions();

      expect(sessions).toContain(testSessionName);
    });

    it('filters sessions by prefix', function() {
      if (skipIfNoTmux()) return;

      createSession(testSessionName);

      // All returned sessions should have the prefix
      const sessions = tmux.listSessions();
      for (const session of sessions) {
        expect(session.startsWith('opus-test-')).toBe(true);
      }
    });
  });

  describe('sendToSession', () => {
    it('sends text to a session without throwing', function() {
      if (skipIfNoTmux()) return;

      createSession(testSessionName);

      expect(() => {
        tmux.sendToSession(testSessionName, 'echo "hello"');
      }).not.toThrow();
    });

    it('throws when session does not exist', function() {
      if (skipIfNoTmux()) return;

      expect(() => {
        tmux.sendToSession('nonexistent-session-12345', 'echo "hello"');
      }).toThrow();
    });

    it('handles text with special characters', function() {
      if (skipIfNoTmux()) return;

      createSession(testSessionName);

      // Should handle quotes, spaces, etc.
      expect(() => {
        tmux.sendToSession(testSessionName, "echo 'hello world'");
      }).not.toThrow();
    });

    it('handles text with single quotes correctly', function() {
      if (skipIfNoTmux()) return;

      createSession(testSessionName);

      // Single quotes need to be escaped properly
      expect(() => {
        tmux.sendToSession(testSessionName, "echo 'it'\\''s working'");
      }).not.toThrow();
    });

    it('can send without pressing Enter', function() {
      if (skipIfNoTmux()) return;

      createSession(testSessionName);

      // pressEnter=false should not throw
      expect(() => {
        tmux.sendToSession(testSessionName, 'partial command', false);
      }).not.toThrow();
    });
  });

  describe('setupOoAlias', () => {
    it('sets up alias in session without throwing', function() {
      if (skipIfNoTmux()) return;

      createSession(testSessionName);

      expect(() => {
        tmux.setupOoAlias(testSessionName, 'claude', 'session-123');
      }).not.toThrow();
    });
  });
});
