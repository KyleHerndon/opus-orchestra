/**
 * TmuxService - Tmux session management for persistent terminal sessions
 *
 * Uses tmux to maintain persistent Claude Code sessions that survive
 * VS Code terminal closes. Sessions are identified by agent sessionId (UUID)
 * to handle agent renames gracefully.
 */

import { getConfigService } from './ConfigService';
import { getCommandService } from './CommandService';
import { getLogger, isLoggerInitialized } from './Logger';
import { Agent } from '../types';

/**
 * Tmux session management service
 */
export class TmuxService {
    private logger = isLoggerInitialized() ? getLogger().child('TmuxService') : null;

    /**
     * Get the tmux session name for an agent.
     * Uses sessionId (UUID) for stability across renames.
     */
    getSessionName(agent: Agent): string {
        const prefix = getConfigService().tmuxSessionPrefix;
        // Use first 12 chars of sessionId for readability
        const shortId = agent.sessionId.replace(/-/g, '').substring(0, 12);
        return `${prefix}-${shortId}`;
    }

    /**
     * Check if a tmux session exists (on host)
     */
    sessionExists(sessionName: string): boolean {
        try {
            getCommandService().exec(`tmux has-session -t "${sessionName}" 2>/dev/null`, '/tmp');
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
            getCommandService().exec(`docker exec ${containerId} tmux has-session -t "${sessionName}" 2>/dev/null`, '/tmp');
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
            getCommandService().execSilent(`tmux kill-session -t "${sessionName}" 2>/dev/null`, '/tmp');
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
            getCommandService().execSilent(`docker exec ${containerId} tmux kill-session -t "${sessionName}" 2>/dev/null`, '/tmp');
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
            const prefix = getConfigService().tmuxSessionPrefix;
            const output = getCommandService().exec('tmux list-sessions -F "#{session_name}" 2>/dev/null', '/tmp');
            return output
                .split('\n')
                .filter(s => s.startsWith(prefix + '-'))
                .map(s => s.trim());
        } catch {
            return [];
        }
    }
}

/**
 * Singleton instance
 */
let tmuxServiceInstance: TmuxService | null = null;

/**
 * Get the global TmuxService instance
 */
export function getTmuxService(): TmuxService {
    if (!tmuxServiceInstance) {
        tmuxServiceInstance = new TmuxService();
    }
    return tmuxServiceInstance;
}

/**
 * Reset the global TmuxService instance (for testing)
 */
export function resetTmuxService(): void {
    tmuxServiceInstance = null;
}
