/**
 * TerminalService - Terminal management with Strategy pattern
 *
 * Provides terminal creation and management for different environments.
 * Uses the Strategy pattern to handle different terminal types.
 */

import * as vscode from 'vscode';
import { agentPath } from '../pathUtils';
import {
    ITerminalService,
    TerminalOptions,
    TerminalType,
    IsolationTier,
    TERMINAL_DELAYS,
} from '../types';
import { getConfigService } from './ConfigService';

// ============================================================================
// Terminal Icon Strategy
// ============================================================================

/**
 * Get the appropriate icon for an agent based on isolation tier
 */
export function getTerminalIcon(isolationTier?: IsolationTier): vscode.ThemeIcon {
    switch (isolationTier) {
        case 'docker':
        case 'gvisor':
            return new vscode.ThemeIcon('package');
        case 'sandbox':
            return new vscode.ThemeIcon('shield');
        case 'firecracker':
            return new vscode.ThemeIcon('vm');
        default:
            return new vscode.ThemeIcon('hubot');
    }
}

// ============================================================================
// Terminal Service Implementation
// ============================================================================

/**
 * Terminal management service
 */
export class TerminalService implements ITerminalService {
    private terminalType: TerminalType;

    constructor(terminalType?: TerminalType) {
        this.terminalType = terminalType ?? getConfigService().terminalType;
    }

    /**
     * Create a new terminal
     */
    createTerminal(options: TerminalOptions & {
        shellPath?: string;
        shellArgs?: string[];
    }): vscode.Terminal {
        // Convert path to Windows format for VS Code terminal cwd
        const windowsCwd = options.cwd ? agentPath(options.cwd).forNodeFs() : undefined;

        const terminalOptions: vscode.TerminalOptions = {
            name: options.name,
            cwd: windowsCwd,
            iconPath: options.iconPath,
            env: options.env,
            shellPath: options.shellPath,
            shellArgs: options.shellArgs,
        };

        return vscode.window.createTerminal(terminalOptions);
    }

    /**
     * Send text to a terminal
     */
    sendText(terminal: vscode.Terminal, text: string): void {
        terminal.sendText(text);
    }

    /**
     * Dispose of a terminal
     */
    dispose(terminal: vscode.Terminal): void {
        terminal.dispose();
    }

    /**
     * Find a terminal by name
     */
    findTerminalByName(name: string): vscode.Terminal | undefined {
        return vscode.window.terminals.find(t => t.name === name);
    }

    /**
     * Check if a terminal reference is still alive
     */
    isTerminalAlive(terminal: vscode.Terminal): boolean {
        return vscode.window.terminals.some(t => t === terminal);
    }

    /**
     * Show a terminal (bring to focus)
     */
    showTerminal(terminal: vscode.Terminal, preserveFocus: boolean = true): void {
        terminal.show(preserveFocus);
    }

    /**
     * Create a terminal for an agent and optionally start Claude
     */
    createAgentTerminal(
        name: string,
        worktreePath: string,
        isolationTier?: IsolationTier,
        options?: {
            autoStartClaude?: boolean;
            claudeCommand?: string;
            sessionId?: string;
            resumeSession?: boolean;
            containerId?: string;
        }
    ): vscode.Terminal {
        const terminal = this.createTerminal({
            name,
            cwd: worktreePath,
            iconPath: getTerminalIcon(isolationTier),
        });

        if (options?.autoStartClaude && options.claudeCommand && options.sessionId) {
            const delay = (isolationTier && isolationTier !== 'standard')
                ? TERMINAL_DELAYS.containerized
                : TERMINAL_DELAYS.standard;

            setTimeout(() => {
                this.startClaudeInTerminal(terminal, {
                    claudeCommand: options.claudeCommand!,
                    sessionId: options.sessionId!,
                    resumeSession: options.resumeSession,
                    containerId: options.containerId,
                    isContainerized: isolationTier !== 'standard' && !!options.containerId,
                });
            }, delay);
        }

        return terminal;
    }

    /**
     * Start Claude in a terminal
     */
    startClaudeInTerminal(
        terminal: vscode.Terminal,
        options: {
            claudeCommand: string;
            sessionId: string;
            resumeSession?: boolean;
            containerId?: string;
            isContainerized?: boolean;
        }
    ): void {
        const { claudeCommand, sessionId, resumeSession, containerId, isContainerized } = options;

        if (isContainerized && containerId) {
            // For containerized agents, exec into the container
            let claudeArgs = resumeSession
                ? `--resume "${sessionId}"`
                : `--session-id "${sessionId}"`;
            claudeArgs += ' --dangerously-skip-permissions';
            terminal.sendText(`docker exec -it ${containerId} ${claudeCommand} ${claudeArgs}`);
        } else {
            // Standard mode - run directly
            if (resumeSession) {
                terminal.sendText(`${claudeCommand} --resume "${sessionId}"`);
            } else {
                terminal.sendText(`${claudeCommand} --session-id "${sessionId}"`);
            }
        }
    }

    /**
     * Get the current terminal type
     */
    getTerminalType(): TerminalType {
        return this.terminalType;
    }
}

/**
 * Singleton instance
 */
let terminalServiceInstance: TerminalService | null = null;

/**
 * Get the global TerminalService instance
 */
export function getTerminalService(): TerminalService {
    if (!terminalServiceInstance) {
        terminalServiceInstance = new TerminalService();
    }
    return terminalServiceInstance;
}

/**
 * Reset the global TerminalService instance (for testing)
 */
export function resetTerminalService(): void {
    terminalServiceInstance = null;
}
