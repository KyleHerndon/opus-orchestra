/**
 * CommandService - Command execution with terminal type support
 *
 * Delegates to ServiceContainer's SystemAdapter for actual execution.
 * This is a facade that provides a familiar API for legacy code.
 *
 * Note: New code should use getContainer().system directly.
 */

import { SystemAdapter, TerminalType } from '@opus-orchestra/core';
import { NodeSystemAdapter } from '@opus-orchestra/core';
import { getConfigService } from './ConfigService';

/**
 * Command execution service - delegates to SystemAdapter
 */
export class CommandService {
    private _system: SystemAdapter | null = null;

    /**
     * Get the underlying system adapter.
     * Uses ServiceContainer when available, falls back to local adapter.
     */
    private get system(): SystemAdapter {
        if (this._system) {
            return this._system;
        }

        // Try to use ServiceContainer's adapter
        try {
            // Dynamic import to avoid circular dependency
            // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
            const { isContainerInitialized, getContainer } = require('../ServiceContainer');
            if (isContainerInitialized()) {
                const containerSystem = getContainer().system as SystemAdapter;
                this._system = containerSystem;
                return containerSystem;
            }
        } catch {
            // ServiceContainer not available yet
        }

        // Fall back to creating a local adapter
        const terminalType = getConfigService().terminalType;
        const localSystem = new NodeSystemAdapter(terminalType);
        this._system = localSystem;
        return localSystem;
    }

    /**
     * Execute a command synchronously
     */
    exec(command: string, cwd: string): string {
        return this.system.execSync(command, cwd);
    }

    /**
     * Execute a command asynchronously
     */
    execAsync(command: string, cwd: string): Promise<string> {
        return this.system.exec(command, cwd);
    }

    /**
     * Execute a command silently (ignore errors and output)
     */
    execSilent(command: string, cwd: string): void {
        this.system.execSilent(command, cwd);
    }

    /**
     * Get the current terminal type
     */
    getTerminalType(): TerminalType {
        return this.system.getTerminalType();
    }

    /**
     * Set the terminal type
     */
    setTerminalType(type: TerminalType): void {
        if (this.system instanceof NodeSystemAdapter) {
            this.system.setTerminalType(type);
        }
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
