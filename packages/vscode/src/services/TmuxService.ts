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
            // Use timeout to prevent hanging if container doesn't exist or isn't running
            getCommandService().execSilent(`timeout 2 docker exec ${containerId} tmux kill-session -t "${sessionName}" 2>/dev/null || true`, '/tmp');
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
 * Singleton instance (fallback when ServiceContainer not available)
 */
let tmuxServiceInstance: TmuxService | null = null;

/**
 * Interface matching core's ITmuxService (uses sessionId string instead of Agent)
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
 * Adapter that wraps TmuxService to match core's ITmuxService interface
 */
class TmuxServiceAdapter implements ITmuxService {
    private wrapped: TmuxService;

    constructor(wrapped: TmuxService) {
        this.wrapped = wrapped;
    }

    getSessionName(sessionId: string): string {
        // Create a minimal agent-like object with just sessionId
        const mockAgent = { sessionId } as Agent;
        return this.wrapped.getSessionName(mockAgent);
    }

    sessionExists(sessionName: string): boolean {
        return this.wrapped.sessionExists(sessionName);
    }

    containerSessionExists(containerId: string, sessionName: string): boolean {
        return this.wrapped.containerSessionExists(containerId, sessionName);
    }

    killSession(sessionName: string): void {
        this.wrapped.killSession(sessionName);
    }

    killContainerSession(containerId: string, sessionName: string): void {
        this.wrapped.killContainerSession(containerId, sessionName);
    }

    listSessions(): string[] {
        return this.wrapped.listSessions();
    }
}

/**
 * Get the global TmuxService instance.
 * Uses ServiceContainer's tmuxService when available (core interface).
 */
export function getTmuxService(): ITmuxService {
    // Try to use ServiceContainer's tmuxService first (it's the canonical instance)
    try {
        // Dynamic import to avoid circular dependency
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { isContainerInitialized, getContainer } = require('../ServiceContainer');
        if (isContainerInitialized()) {
            return getContainer().tmuxService;
        }
    } catch {
        // ServiceContainer not available yet
    }

    // Fall back to local singleton (wrapped to match core interface)
    if (!tmuxServiceInstance) {
        tmuxServiceInstance = new TmuxService();
    }
    return new TmuxServiceAdapter(tmuxServiceInstance);
}

/**
 * Reset the global TmuxService instance (for testing)
 */
export function resetTmuxService(): void {
    tmuxServiceInstance = null;
}
