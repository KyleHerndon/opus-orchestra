/**
 * UnisolatedAdapter - No-op adapter for when no container isolation is used
 *
 * Commands run directly on the host system via SystemAdapter.
 */

import { SystemAdapter } from '../adapters/SystemAdapter';
import { ContainerAdapter, ContainerDisplayInfo, ContainerStats, ShellCommand } from './ContainerAdapter';

/**
 * Unisolated adapter - no container isolation.
 * Uses SystemAdapter for command execution.
 */
export class UnisolatedAdapter implements ContainerAdapter {
  readonly type = 'unisolated';

  private system: SystemAdapter;

  constructor(system: SystemAdapter) {
    this.system = system;
  }

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
    // Execute directly on host using SystemAdapter
    // Use home directory as cwd since there's no container context
    const homeDir = this.system.getHomeDirectory();
    return this.system.execSync(command, homeDir);
  }

  async destroy(_containerId: string): Promise<void> {
    // Nothing to destroy - no container was created
  }

  async getStats(_containerId: string): Promise<ContainerStats | null> {
    // No container stats available in unisolated mode
    return null;
  }

  getShellCommand(_containerId: string, _worktreePath: string): ShellCommand | null {
    // Unisolated mode uses default shell - no special command needed
    return null;
  }
}
