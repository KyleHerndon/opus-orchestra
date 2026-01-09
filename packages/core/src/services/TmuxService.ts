/**
 * TmuxService - Tmux session management for persistent terminal sessions
 *
 * Uses tmux to maintain persistent Claude Code sessions that survive
 * terminal closes. Sessions are identified by agent sessionId (UUID)
 * to handle agent renames gracefully.
 *
 * Uses SystemAdapter for command execution - no OS-specific code.
 */

import { SystemAdapter } from '../adapters/SystemAdapter';
import { ILogger } from './Logger';

/**
 * Default working directory for tmux commands that don't need a specific cwd.
 * We use /tmp because tmux commands like has-session, kill-session, list-sessions,
 * and send-keys operate on the tmux server, not the filesystem.
 */
const TMUX_DEFAULT_CWD = '/tmp';

/**
 * Tmux service interface
 */
export interface ITmuxService {
  getSessionName(sessionId: string): string;
  sessionExists(sessionName: string): boolean;
  containerSessionExists(containerId: string, sessionName: string): boolean;
  killSession(sessionName: string): void;
  killContainerSession(containerId: string, sessionName: string): void;
  listSessions(): string[];

  // Session creation and management
  createOrAttachSession(sessionName: string, cwd: string): void;
  createDetachedSession(sessionName: string, cwd: string): void;
  sendToSession(sessionName: string, text: string, pressEnter?: boolean): void;

  // Helper for oo alias
  getOoAliasCommand(claudeCommand: string, sessionId: string): string;
  setupOoAlias(sessionName: string, claudeCommand: string, sessionId: string): void;
}

/**
 * Tmux session management service
 */
export class TmuxService implements ITmuxService {
  private system: SystemAdapter;
  private logger?: ILogger;
  private sessionPrefix: string;

  constructor(system: SystemAdapter, sessionPrefix: string, logger?: ILogger) {
    this.system = system;
    this.sessionPrefix = sessionPrefix;
    this.logger = logger?.child('TmuxService');
  }

  /**
   * Get the tmux session name for an agent.
   * Uses sessionId (UUID) for stability across renames.
   */
  getSessionName(sessionId: string): string {
    // Use first 12 chars of sessionId for readability
    const shortId = sessionId.replace(/-/g, '').substring(0, 12);
    return `${this.sessionPrefix}-${shortId}`;
  }

  /**
   * Check if a tmux session exists (on host)
   */
  sessionExists(sessionName: string): boolean {
    try {
      this.system.execSync(`tmux has-session -t "${sessionName}" 2>/dev/null`, TMUX_DEFAULT_CWD);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a tmux session exists inside a container
   */
  containerSessionExists(containerId: string, sessionName: string): boolean {
    try {
      this.system.execSync(
        `docker exec ${containerId} tmux has-session -t "${sessionName}" 2>/dev/null`,
        TMUX_DEFAULT_CWD
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Kill a tmux session (cleanup)
   */
  killSession(sessionName: string): void {
    try {
      this.system.execSilent(`tmux kill-session -t "${sessionName}" 2>/dev/null`, TMUX_DEFAULT_CWD);
      this.logger?.debug(`Killed tmux session: ${sessionName}`);
    } catch {
      // Session may not exist, that's fine
    }
  }

  /**
   * Kill a tmux session inside a container
   */
  killContainerSession(containerId: string, sessionName: string): void {
    try {
      // Use timeout to prevent hanging if container doesn't exist or isn't running
      this.system.execSilent(
        `timeout 2 docker exec ${containerId} tmux kill-session -t "${sessionName}" 2>/dev/null || true`,
        TMUX_DEFAULT_CWD
      );
      this.logger?.debug(`Killed container tmux session: ${sessionName} in ${containerId}`);
    } catch {
      // Session may not exist, that's fine
    }
  }

  /**
   * List all opus tmux sessions
   */
  listSessions(): string[] {
    try {
      const output = this.system.execSync(
        'tmux list-sessions -F "#{session_name}" 2>/dev/null',
        TMUX_DEFAULT_CWD
      );
      return output
        .split('\n')
        .filter(s => s.startsWith(this.sessionPrefix + '-'))
        .map(s => s.trim());
    } catch {
      return [];
    }
  }

  /**
   * Update the session prefix (e.g., when config changes)
   */
  setSessionPrefix(prefix: string): void {
    this.sessionPrefix = prefix;
  }

  /**
   * Create or attach to a tmux session.
   * Uses -A flag: creates session if it doesn't exist, attaches if it does.
   * This is the recommended way to ensure a session exists.
   *
   * Note: This runs in the foreground and will block until detached.
   * For non-blocking creation, use createDetachedSession().
   */
  createOrAttachSession(sessionName: string, cwd: string): void {
    try {
      // -A: attach to session if exists, create if not
      // -s: session name
      // -c: starting directory
      this.system.execSync(
        `tmux new-session -A -s "${sessionName}" -c "${cwd}"`,
        cwd
      );
      this.logger?.debug(`Created/attached to tmux session: ${sessionName}`);
    } catch (error) {
      this.logger?.error(`Failed to create/attach tmux session: ${sessionName}`, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Create a detached tmux session (runs in background).
   * Uses -A -d flags: creates if not exists, always detached.
   * Safe to call multiple times - won't error if session exists.
   */
  createDetachedSession(sessionName: string, cwd: string): void {
    try {
      // -A: attach to session if exists, create if not
      // -d: detached (don't attach, run in background)
      // -s: session name
      // -c: starting directory
      this.system.execSync(
        `tmux new-session -A -d -s "${sessionName}" -c "${cwd}"`,
        cwd
      );
      this.logger?.debug(`Created detached tmux session: ${sessionName}`);
    } catch (error) {
      this.logger?.error(`Failed to create detached tmux session: ${sessionName}`, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Send text to a tmux session.
   * @param sessionName - The tmux session name
   * @param text - The text to send
   * @param pressEnter - Whether to press Enter after the text (default: true)
   */
  sendToSession(sessionName: string, text: string, pressEnter: boolean = true): void {
    try {
      // Escape single quotes in text for shell safety
      const escapedText = text.replace(/'/g, "'\\''");
      const enterKey = pressEnter ? ' Enter' : '';
      this.system.execSync(
        `tmux send-keys -t "${sessionName}" '${escapedText}'${enterKey}`,
        TMUX_DEFAULT_CWD
      );
      this.logger?.debug(`Sent text to tmux session: ${sessionName}`);
    } catch (error) {
      this.logger?.error(`Failed to send text to tmux session: ${sessionName}`, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Generate the oo alias command for Claude Code.
   * This alias allows users to type 'oo' instead of the full claude command.
   * @param claudeCommand - The claude command (default: 'claude')
   * @param sessionId - The agent's session ID (UUID)
   */
  getOoAliasCommand(claudeCommand: string, sessionId: string): string {
    return `alias oo='${claudeCommand} --session-id "${sessionId}"'`;
  }

  /**
   * Set up the oo alias in a tmux session.
   * @param sessionName - The tmux session name
   * @param claudeCommand - The claude command (default: 'claude')
   * @param sessionId - The agent's session ID (UUID)
   */
  setupOoAlias(sessionName: string, claudeCommand: string, sessionId: string): void {
    const aliasCommand = this.getOoAliasCommand(claudeCommand, sessionId);
    this.sendToSession(sessionName, aliasCommand, true);
    this.logger?.debug(`Set up oo alias in tmux session: ${sessionName}`);
  }
}
