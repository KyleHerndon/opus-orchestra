/**
 * CommandService - Command execution with terminal type support
 *
 * Provides a unified interface for executing shell commands across
 * different terminal environments (WSL, Git Bash, PowerShell, etc.)
 */

import { execSync, exec } from 'child_process';
import * as os from 'os';
import { agentPath } from '../pathUtils';
import { TerminalType, GIT_BASH_PATH } from '../types';
import { getConfigService } from './ConfigService';

/**
 * Command configuration for execution
 */
interface CommandConfig {
    /** Full command to execute (may wrap the original) */
    command: string;
    /** Working directory for native execution */
    cwd?: string;
    /** Shell to use for native execution */
    shell?: string;
}

/**
 * Command execution service
 */
export class CommandService {
    private terminalType: TerminalType;

    constructor(terminalType?: TerminalType) {
        this.terminalType = terminalType ?? getConfigService().terminalType;
    }

    /**
     * Build command configuration based on terminal type.
     * Centralizes the terminal-type-specific command wrapping logic.
     */
    private buildCommandConfig(command: string, cwd: string): CommandConfig {
        const terminalPath = agentPath(cwd).forTerminal();

        // On Linux (e.g., WSL VS Code), execute directly
        if (os.platform() !== 'win32') {
            return { command, cwd: terminalPath, shell: '/bin/bash' };
        }

        // On Windows, use the configured terminal type
        switch (this.terminalType) {
            case 'wsl': {
                const escapedCmd = command.replace(/'/g, "'\\''");
                return { command: `wsl bash -c "cd '${terminalPath}' && ${escapedCmd}"` };
            }
            case 'gitbash': {
                const escapedCmd = command.replace(/'/g, "'\\''");
                return { command: `"${GIT_BASH_PATH}" -c "cd '${terminalPath}' && ${escapedCmd}"` };
            }
            case 'bash':
                return { command, cwd: terminalPath, shell: '/bin/bash' };
            case 'powershell':
            case 'cmd':
            default:
                return { command, cwd: terminalPath };
        }
    }

    /**
     * Execute a command synchronously
     */
    exec(command: string, cwd: string): string {
        const config = this.buildCommandConfig(command, cwd);
        return execSync(config.command, {
            cwd: config.cwd,
            encoding: 'utf-8',
            shell: config.shell,
        });
    }

    /**
     * Execute a command asynchronously
     */
    execAsync(command: string, cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const config = this.buildCommandConfig(command, cwd);
            exec(config.command, {
                cwd: config.cwd,
                encoding: 'utf-8',
                shell: config.shell,
            }, (error, stdout, _stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout);
                }
            });
        });
    }

    /**
     * Execute a command silently (ignore errors and output)
     */
    execSilent(command: string, cwd: string): void {
        try {
            const config = this.buildCommandConfig(command, cwd);
            execSync(config.command, {
                cwd: config.cwd,
                stdio: 'ignore',
                shell: config.shell,
            });
        } catch {
            // Silently ignore errors
        }
    }

    /**
     * Get the current terminal type
     */
    getTerminalType(): TerminalType {
        return this.terminalType;
    }

    /**
     * Set the terminal type
     */
    setTerminalType(type: TerminalType): void {
        this.terminalType = type;
    }
}

/**
 * Singleton instance
 */
let commandServiceInstance: CommandService | null = null;

/**
 * Get the global CommandService instance
 */
export function getCommandService(): CommandService {
    if (!commandServiceInstance) {
        commandServiceInstance = new CommandService();
    }
    return commandServiceInstance;
}

/**
 * Reset the global CommandService instance (for testing)
 */
export function resetCommandService(): void {
    commandServiceInstance = null;
}
