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
} from '../types';
import { getConfigService } from './ConfigService';
import { getContainerConfigService } from './ContainerConfigService';

// ============================================================================
// Terminal Icon Strategy
// ============================================================================

/**
 * Get the appropriate icon for an agent based on container config name.
 * Looks up the config type to determine the icon.
 */
export function getTerminalIcon(containerConfigName?: string): vscode.ThemeIcon {
    if (!containerConfigName || containerConfigName === 'unisolated') {
        return new vscode.ThemeIcon('hubot');
    }

    // Try to get the config type from the config service
    // For prefixed names like "repo:dev", we need to look up the type
    const configService = getContainerConfigService();
    // Default to workspace root if we can't determine repoPath
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const configRef = configService.loadConfigRef(containerConfigName, workspaceRoot);

    if (configRef) {
        switch (configRef.type) {
            case 'docker':
                return new vscode.ThemeIcon('package');
            case 'cloud-hypervisor':
                return new vscode.ThemeIcon('vm');
        }
    }

    // Default icon for unknown container types
    return new vscode.ThemeIcon('shield');
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
