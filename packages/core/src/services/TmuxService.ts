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
  getSessionName(sessionId: string): string;
  sessionExists(sessionName: string): boolean;
  containerSessionExists(containerId: string, sessionName: string): boolean;
  killSession(sessionName: string): void;
  killContainerSession(containerId: string, sessionName: string): void;
  listSessions(): string[];
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
      this.system.execSync(`tmux has-session -t "${sessionName}" 2>/dev/null`, '/tmp');
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
        '/tmp'
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
      this.system.execSilent(`tmux kill-session -t "${sessionName}" 2>/dev/null`, '/tmp');
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
        '/tmp'
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
        '/tmp'
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
}
