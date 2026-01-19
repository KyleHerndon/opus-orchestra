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
 * Tmux service interface
 */
export interface ITmuxService {
  isTmuxAvailable(): boolean;
  getSessionName(sessionId: string): string;
  /** Get session name for an agent, handling missing sessionId with fallback to sanitized name */
  getAgentSessionName(agent: { sessionId?: string; name: string }): string;
  sessionExists(sessionName: string): boolean;
  containerSessionExists(containerId: string, sessionName: string): boolean;
  killSession(sessionName: string): void;
  killContainerSession(containerId: string, sessionName: string): void;
  listSessions(): string[];

  // Session creation and management
  createOrAttachSession(sessionName: string, cwd: string): void;
  createDetachedSession(sessionName: string, cwd: string): void;
  sendToSession(sessionName: string, text: string, pressEnter?: boolean): void;
  /** Send raw keystrokes (unquoted) for interactive prompts. Keys: 1, Escape, Enter, etc. */
  sendRawKeys(sessionName: string, keys: string): void;

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
  private tmuxAvailable: boolean | null = null; // Cached availability check

  constructor(system: SystemAdapter, sessionPrefix: string, logger?: ILogger) {
    this.system = system;
    this.sessionPrefix = sessionPrefix;
    this.logger = logger?.child({ component: 'TmuxService' });
  }

  /**
   * Get the default working directory for tmux commands that don't need a specific cwd.
   * Tmux commands like has-session, kill-session, list-sessions, and send-keys
   * operate on the tmux server, not the filesystem, so any writable dir works.
   */
  private getDefaultCwd(): string {
    return this.system.getTempDirectory();
  }

  /**
   * Check if tmux is installed and available.
   * Result is cached after first check.
   */
  isTmuxAvailable(): boolean {
    if (this.tmuxAvailable !== null) {
      return this.tmuxAvailable;
    }

    try {
      this.system.execSync('tmux -V', this.getDefaultCwd());
      this.tmuxAvailable = true;
      this.logger?.debug('tmux is available');
    } catch {
      this.tmuxAvailable = false;
      this.logger?.warn('tmux is not installed or not available in PATH');
    }

    return this.tmuxAvailable;
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
   * Get the tmux session name for an agent, with fallback for missing sessionId.
   * This is the SINGLE SOURCE OF TRUTH for agent session naming.
   *
   * Uses sessionId-based naming when available (stable across renames).
   * Falls back to sanitized agent name for legacy agents without sessionId.
   */
  getAgentSessionName(agent: { sessionId?: string; name: string }): string {
    if (agent.sessionId) {
      return this.getSessionName(agent.sessionId);
    }
    // Fallback for legacy agents: sanitize name to valid tmux session name
    return `${this.sessionPrefix}-${agent.name.replace(/[^a-zA-Z0-9-]/g, '-')}`;
  }

  /**
   * Check if a tmux session exists (on host).
   * Returns false if tmux is not available or if the session doesn't exist.
   */
  sessionExists(sessionName: string): boolean {
    if (!this.isTmuxAvailable()) {
      this.logger?.debug(`sessionExists: tmux not available, returning false for ${sessionName}`);
      return false;
    }

    try {
      this.system.execSync(`tmux has-session -t "${sessionName}" 2>/dev/null`, this.getDefaultCwd());
      return true;
    } catch {
      // Session doesn't exist (exit code 1 from has-session)
      return false;
    }
  }

  /**
   * Check if a tmux session exists inside a container.
   * Returns false if the container is not running or the session doesn't exist.
   */
  containerSessionExists(containerId: string, sessionName: string): boolean {
    try {
      this.system.execSync(
        `docker exec ${containerId} tmux has-session -t "${sessionName}" 2>/dev/null`,
        this.getDefaultCwd()
      );
      return true;
    } catch {
      // Could be: container not running, tmux not in container, or session doesn't exist
      // All cases mean "session not available", so returning false is correct
      return false;
    }
  }

  /**
   * Kill a tmux session (cleanup).
   * Logs info when session is killed, debug when session doesn't exist.
   */
  killSession(sessionName: string): void {
    if (!this.isTmuxAvailable()) {
      this.logger?.debug(`killSession: tmux not available, skipping ${sessionName}`);
      return;
    }

    try {
      this.system.execSilent(`tmux kill-session -t "${sessionName}" 2>/dev/null`, this.getDefaultCwd());
      this.logger?.info(`Killed tmux session: ${sessionName}`);
    } catch {
      // Session may not exist - this is expected during cleanup
      this.logger?.debug(`killSession: session ${sessionName} did not exist or already killed`);
    }
  }

  /**
   * Kill a tmux session inside a container.
   * Logs info when session is killed, handles container/session not existing gracefully.
   */
  killContainerSession(containerId: string, sessionName: string): void {
    try {
      // Use timeout to prevent hanging if container doesn't exist or isn't running
      this.system.execSilent(
        `timeout 2 docker exec ${containerId} tmux kill-session -t "${sessionName}" 2>/dev/null || true`,
        this.getDefaultCwd()
      );
      this.logger?.info(`Killed container tmux session: ${sessionName} in ${containerId}`);
    } catch {
      // Container might not exist or tmux not available in container
      this.logger?.debug(`killContainerSession: could not kill session ${sessionName} in container ${containerId}`);
    }
  }

  /**
   * List all opus tmux sessions.
   * Returns empty array if tmux is not available.
   */
  listSessions(): string[] {
    if (!this.isTmuxAvailable()) {
      this.logger?.debug('listSessions: tmux not available, returning empty list');
      return [];
    }

    try {
      const output = this.system.execSync(
        'tmux list-sessions -F "#{session_name}" 2>/dev/null',
        this.getDefaultCwd()
      );
      return output
        .split('\n')
        .filter(s => s.startsWith(this.sessionPrefix + '-'))
        .map(s => s.trim());
    } catch {
      // No tmux server running or other error
      this.logger?.debug('listSessions: no tmux sessions found or server not running');
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
      this.logger?.error({ err: error instanceof Error ? error : undefined }, `Failed to create/attach tmux session: ${sessionName}`);
      throw error;
    }
  }

  /**
   * Create a detached tmux session (runs in background).
   * Checks if session exists first, creates only if needed.
   * Safe to call multiple times - won't error if session exists.
   */
  createDetachedSession(sessionName: string, cwd: string): void {
    try {
      // First check if session already exists
      if (this.sessionExists(sessionName)) {
        this.logger?.debug(`Tmux session already exists: ${sessionName}`);
        return;
      }

      // Create new detached session (no -A flag to avoid terminal issues)
      // -d: detached (don't attach, run in background)
      // -s: session name
      // -c: starting directory
      this.system.execSync(
        `tmux new-session -d -s "${sessionName}" -c "${cwd}"`,
        cwd
      );
      this.logger?.debug(`Created detached tmux session: ${sessionName}`);
    } catch (error) {
      this.logger?.error({ err: error instanceof Error ? error : undefined }, `Failed to create detached tmux session: ${sessionName}`);
      throw error;
    }
  }

  /**
   * Send text to a tmux session (quoted, for typing text).
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
        this.getDefaultCwd()
      );
      this.logger?.debug(`Sent text to tmux session: ${sessionName}`);
    } catch (error) {
      this.logger?.error({ err: error instanceof Error ? error : undefined }, `Failed to send text to tmux session: ${sessionName}`);
      throw error;
    }
  }

  /**
   * Send raw keystrokes to a tmux session (unquoted, for interactive prompts).
   * Keys are sent as tmux key names: 1, 2, 3, Enter, Escape, Tab, etc.
   * @param sessionName - The tmux session name
   * @param keys - Space-separated key names (e.g., "1", "Escape", "y Enter")
   */
  sendRawKeys(sessionName: string, keys: string): void {
    try {
      this.system.execSync(
        `tmux send-keys -t "${sessionName}" ${keys}`,
        this.getDefaultCwd()
      );
      this.logger?.debug(`Sent raw keys to tmux session ${sessionName}: ${keys}`);
    } catch (error) {
      this.logger?.error({ err: error instanceof Error ? error : undefined }, `Failed to send raw keys to tmux session: ${sessionName}`);
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
