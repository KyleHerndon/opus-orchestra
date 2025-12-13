/**
 * CommandService - Command execution with terminal type support
 *
 * Provides a unified interface for executing shell commands across
 * different terminal environments (WSL, Git Bash, PowerShell, etc.)
 */

import { execSync, exec } from 'child_process';
import * as os from 'os';
import { agentPath } from '../pathUtils';
import { ICommandService, TerminalType, GIT_BASH_PATH } from '../types';
import { getConfigService } from './ConfigService';

/**
 * Command execution service
 */
export class CommandService implements ICommandService {
    private terminalType: TerminalType;

    constructor(terminalType?: TerminalType) {
        this.terminalType = terminalType ?? getConfigService().terminalType;
    }

    /**
     * Execute a command synchronously
     */
    exec(command: string, cwd: string): string {
        const terminalPath = agentPath(cwd).forTerminal();

        // If running on Linux (e.g., WSL VS Code), execute directly - don't call `wsl` from within WSL
        if (os.platform() !== 'win32') {
            return execSync(command, { cwd: terminalPath, encoding: 'utf-8', shell: '/bin/bash' });
        }

        // On Windows, use the configured terminal type
        switch (this.terminalType) {
            case 'wsl': {
                const escapedCmd = command.replace(/'/g, "'\\''");
                const wslCommand = `wsl bash -c "cd '${terminalPath}' && ${escapedCmd}"`;
                return execSync(wslCommand, { encoding: 'utf-8' });
            }
            case 'gitbash': {
                const escapedCmd = command.replace(/'/g, "'\\''");
                const gitBashCmd = `"${GIT_BASH_PATH}" -c "cd '${terminalPath}' && ${escapedCmd}"`;
                return execSync(gitBashCmd, { encoding: 'utf-8' });
            }
            case 'bash':
                return execSync(command, { cwd: terminalPath, encoding: 'utf-8', shell: '/bin/bash' });
            case 'powershell':
            case 'cmd':
            default:
                return execSync(command, { cwd: terminalPath, encoding: 'utf-8' });
        }
    }

    /**
     * Execute a command asynchronously
     */
    execAsync(command: string, cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const terminalPath = agentPath(cwd).forTerminal();
            const platform = os.platform();

            let fullCommand: string;
            const execOptions: { cwd?: string; encoding: 'utf-8'; shell?: string } = { encoding: 'utf-8' };

            // If running on Linux (e.g., WSL VS Code), execute directly
            if (platform !== 'win32') {
                fullCommand = command;
                execOptions.cwd = terminalPath;
                execOptions.shell = '/bin/bash';
            } else {
                // On Windows, use the configured terminal type
                switch (this.terminalType) {
                    case 'wsl': {
                        const escapedCmd = command.replace(/'/g, "'\\''");
                        fullCommand = `wsl bash -c "cd '${terminalPath}' && ${escapedCmd}"`;
                        break;
                    }
                    case 'gitbash': {
                        const escapedCmd = command.replace(/'/g, "'\\''");
                        fullCommand = `"${GIT_BASH_PATH}" -c "cd '${terminalPath}' && ${escapedCmd}"`;
                        break;
                    }
                    case 'bash':
                        fullCommand = command;
                        execOptions.cwd = terminalPath;
                        execOptions.shell = '/bin/bash';
                        break;
                    case 'powershell':
                    case 'cmd':
                    default:
                        fullCommand = command;
                        execOptions.cwd = terminalPath;
                        break;
                }
            }

            exec(fullCommand, execOptions, (error, stdout, _stderr) => {
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
            const terminalPath = agentPath(cwd).forTerminal();
            const platform = os.platform();

            // If running on Linux (e.g., WSL VS Code), execute directly
            if (platform !== 'win32') {
                execSync(command, { cwd: terminalPath, stdio: 'ignore', shell: '/bin/bash' });
                return;
            }

            // On Windows, use the configured terminal type
            switch (this.terminalType) {
                case 'wsl': {
                    const escapedCmd = command.replace(/'/g, "'\\''");
                    execSync(`wsl bash -c "cd '${terminalPath}' && ${escapedCmd}"`, { stdio: 'ignore' });
                    break;
                }
                case 'gitbash': {
                    const escapedCmd = command.replace(/'/g, "'\\''");
                    execSync(`"${GIT_BASH_PATH}" -c "cd '${terminalPath}' && ${escapedCmd}"`, { stdio: 'ignore' });
                    break;
                }
                case 'bash':
                    execSync(command, { cwd: terminalPath, stdio: 'ignore', shell: '/bin/bash' });
                    break;
                case 'powershell':
                case 'cmd':
                default:
                    execSync(command, { cwd: terminalPath, stdio: 'ignore' });
                    break;
            }
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
