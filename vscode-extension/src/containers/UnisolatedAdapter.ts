/**
 * Unisolated adapter implementation.
 * No-op adapter for when no container isolation is used.
 * Commands run directly on the host system.
 */

import { execSync } from 'child_process';
import { ContainerAdapter, ContainerDisplayInfo } from './ContainerAdapter';

export class UnisolatedAdapter implements ContainerAdapter {
    readonly type = 'unisolated';

    async isAvailable(): Promise<boolean> {
        // Always available - no container system needed
        return true;
    }

    async getDisplayInfo(_definitionPath: string): Promise<ContainerDisplayInfo> {
        // Static info - no definition file needed for unisolated mode
        return {
            name: 'Unisolated',
            description: 'No isolation - runs directly on host with manual approval for all operations',
        };
    }

    async create(_definitionPath: string, worktreePath: string, agentId: number, _sessionId?: string): Promise<string> {
        // Return a placeholder ID - no actual container is created
        // Note: sessionId is not used for unisolated mode - Claude is started via terminal
        return `unisolated-${agentId}-${worktreePath.replace(/[^a-zA-Z0-9]/g, '_')}`;
    }

    async exec(_containerId: string, command: string): Promise<string> {
        // Execute directly on host
        return execSync(command, { encoding: 'utf8' });
    }

    async destroy(_containerId: string): Promise<void> {
        // Nothing to destroy - no container was created
    }

    async getStats(_containerId: string): Promise<{ memoryMB: number; cpuPercent: number } | null> {
        // No container stats available in unisolated mode
        return null;
    }

    getShellCommand(_containerId: string, _worktreePath: string): { shellPath: string; shellArgs?: string[] } | null {
        // Unisolated mode uses default shell - no special command needed
        return null;
    }
}
