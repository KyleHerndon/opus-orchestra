/**
 * TmuxService - Tmux session management for persistent terminal sessions
 *
 * Uses tmux to maintain persistent Claude Code sessions that survive
 * VS Code terminal closes. Sessions are identified by agent sessionId (UUID)
 * to handle agent renames gracefully.
 */

import { execSync } from 'child_process';
import { getConfigService } from './ConfigService';
import { getLogger, isLoggerInitialized } from './Logger';
import { Agent } from '../types';

export interface TmuxSessionInfo {
    name: string;
    exists: boolean;
    attached: boolean;
}

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
            execSync(`tmux has-session -t "${sessionName}" 2>/dev/null`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
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
            execSync(`docker exec ${containerId} tmux has-session -t "${sessionName}" 2>/dev/null`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get the command to attach or create a tmux session (host)
     * Uses `tmux new-session -A` which attaches if exists, creates if not
     */
    getAttachOrCreateCommand(sessionName: string, workingDir?: string): string {
        // -A: attach if exists, create if not
        // -s: session name
        // -c: starting directory (only used when creating)
        if (workingDir) {
            return `tmux new-session -A -s "${sessionName}" -c "${workingDir}"`;
        }
        return `tmux new-session -A -s "${sessionName}"`;
    }

    /**
     * Get the command to attach or create a tmux session inside a container
     */
    getContainerAttachOrCreateCommand(
        containerId: string,
        sessionName: string,
        workingDir?: string
    ): string {
        const tmuxCmd = workingDir
            ? `tmux new-session -A -s "${sessionName}" -c "${workingDir}"`
            : `tmux new-session -A -s "${sessionName}"`;

        return `docker exec -it ${containerId} ${tmuxCmd}`;
    }

    /**
     * Build the full command to start Claude in a tmux session.
     *
     * For standard tier: Creates tmux session on host
     * For container tiers: Creates tmux session inside container
     *
     * @param agent The agent
     * @param startClaude Whether to start Claude after creating the session
     * @returns Object with command and whether this is a new session
     */
    buildTmuxCommand(
        agent: Agent,
        options: {
            startClaude: boolean;
            claudeCommand: string;
            resumeSession: boolean;
        }
    ): { command: string; isNewSession: boolean } {
        const sessionName = this.getSessionName(agent);
        const isContainerized = agent.isolationTier !== 'standard' && !!agent.containerInfo?.id;

        let isNewSession: boolean;

        if (isContainerized) {
            isNewSession = !this.containerSessionExists(agent.containerInfo!.id, sessionName);
        } else {
            isNewSession = !this.sessionExists(sessionName);
        }

        this.logger?.debug(
            `buildTmuxCommand: agent=${agent.name}, session=${sessionName}, ` +
            `isContainerized=${isContainerized}, isNewSession=${isNewSession}`
        );

        // Build the tmux command
        let command: string;

        if (isContainerized) {
            // For containers, we need to exec into the container and run tmux there
            const containerId = agent.containerInfo!.id;

            if (isNewSession && options.startClaude) {
                // Create new session and immediately run Claude
                const claudeArgs = options.resumeSession
                    ? `--resume "${agent.sessionId}"`
                    : `--session-id "${agent.sessionId}"`;
                // Add --dangerously-skip-permissions for containerized agents
                const fullClaudeCmd = `${options.claudeCommand} ${claudeArgs} --dangerously-skip-permissions`;

                // Create session and run Claude command
                command = `docker exec -it ${containerId} tmux new-session -s "${sessionName}" "${fullClaudeCmd}"`;
            } else {
                // Attach to existing session (or create empty one if something went wrong)
                command = `docker exec -it ${containerId} tmux new-session -A -s "${sessionName}"`;
            }
        } else {
            // Standard tier - run tmux on host
            if (isNewSession && options.startClaude) {
                // Create new session and immediately run Claude
                const claudeArgs = options.resumeSession
                    ? `--resume "${agent.sessionId}"`
                    : `--session-id "${agent.sessionId}"`;
                const fullClaudeCmd = `${options.claudeCommand} ${claudeArgs}`;

                // Create session with Claude as the initial command
                // Note: When Claude exits, the tmux session will close
                command = `tmux new-session -s "${sessionName}" -c "${agent.worktreePath}" "${fullClaudeCmd}"`;
            } else {
                // Attach to existing session
                command = `tmux new-session -A -s "${sessionName}" -c "${agent.worktreePath}"`;
            }
        }

        return { command, isNewSession };
    }

    /**
     * Kill a tmux session (cleanup)
     */
    killSession(sessionName: string): void {
        try {
            execSync(`tmux kill-session -t "${sessionName}" 2>/dev/null`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
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
            execSync(`docker exec ${containerId} tmux kill-session -t "${sessionName}" 2>/dev/null`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
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
            const output = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', {
                encoding: 'utf-8'
            });
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
