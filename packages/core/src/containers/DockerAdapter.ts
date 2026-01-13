/**
 * DockerAdapter - Docker container management
 *
 * Uses SystemAdapter for all file and command operations.
 * Platform-agnostic implementation.
 */

import { SystemAdapter } from '../adapters/SystemAdapter';
import { ILogger } from '../services/Logger';
import { ContainerAdapter, ContainerDisplayInfo, ContainerStats, ShellCommand } from './ContainerAdapter';

/**
 * Docker container definition file format.
 * Parsed by DockerAdapter from definition JSON files.
 */
export interface DockerDefinition {
  name: string;
  description?: string;
  image: string;
  memoryLimit?: string;
  cpuLimit?: string;
  network?: 'none' | 'bridge' | 'host';
  runtime?: string;  // e.g., 'runsc' for gVisor
  allowedDomains?: string[];
  mounts?: Array<{
    source: string;
    target: string;
    readonly?: boolean;
  }>;
  environment?: Record<string, string>;
  pidsLimit?: number;
  readOnly?: boolean;
  tmpSize?: string;
  homeSize?: string;
  entrypoint?: string[];
}

/**
 * Container labels for identification
 */
const CONTAINER_LABELS = {
  managed: 'opus-orchestra.managed=true',
  agentId: (id: number) => `opus-orchestra.agent-id=${id}`,
  worktree: (path: string) => `opus-orchestra.worktree-path=${path}`,
} as const;

/**
 * Default resource limits
 */
const DEFAULTS = {
  memory: '4g',
  cpu: '2',
  pidsLimit: 100,
  tmpSize: '100m',
  homeSize: '500m',
} as const;

/**
 * Docker container adapter.
 * Uses SystemAdapter for command execution and file operations.
 */
export class DockerAdapter implements ContainerAdapter {
  readonly type = 'docker';

  private system: SystemAdapter;
  private logger?: ILogger;

  constructor(system: SystemAdapter, logger?: ILogger) {
    this.system = system;
    this.logger = logger?.child({ component: 'DockerAdapter' });
  }

  async isAvailable(): Promise<boolean> {
    try {
      this.system.execSync('docker info', '/tmp');
      return true;
    } catch {
      return false;
    }
  }

  async getDisplayInfo(definitionPath: string): Promise<ContainerDisplayInfo> {
    const definition = this.loadDefinition(definitionPath);
    return {
      name: definition.name,
      description: definition.description,
      memoryLimit: definition.memoryLimit,
      cpuLimit: definition.cpuLimit,
    };
  }

  async create(definitionPath: string, worktreePath: string, agentId: number, sessionId?: string): Promise<string> {
    const definition = this.loadDefinition(definitionPath);

    this.logger?.debug(`Creating docker container for agent ${agentId} with definition: ${definitionPath}`);

    // Convert worktree path for Docker (needs to be accessible from Docker daemon)
    const dockerWorktreePath = this.toDockerPath(worktreePath);

    // Build docker run command with security hardening
    const args: string[] = [
      'run',
      '-d',  // Detached
      '--name', `opus-agent-${agentId}`,

      // Labels for identification
      '-l', CONTAINER_LABELS.managed,
      '-l', CONTAINER_LABELS.agentId(agentId),
      '-l', CONTAINER_LABELS.worktree(worktreePath),

      // Security hardening
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
    ];

    // Read-only root filesystem (if enabled)
    if (definition.readOnly !== false) {
      args.push('--read-only');
    }

    // Writable temp directories
    const tmpSize = definition.tmpSize || DEFAULTS.tmpSize;
    const homeSize = definition.homeSize || DEFAULTS.homeSize;
    args.push('--tmpfs', `/tmp:rw,noexec,nosuid,size=${tmpSize}`);
    args.push('--tmpfs', `/home/agent:rw,noexec,nosuid,size=${homeSize}`);

    // Network mode
    const network = definition.network || 'none';
    args.push('--network', network);

    // Resource limits
    const memoryLimit = definition.memoryLimit || DEFAULTS.memory;
    const cpuLimit = definition.cpuLimit || DEFAULTS.cpu;
    const pidsLimit = definition.pidsLimit || DEFAULTS.pidsLimit;
    args.push('--memory', memoryLimit);
    args.push('--cpus', cpuLimit);
    args.push('--pids-limit', String(pidsLimit));

    // Run as non-root
    args.push('--user', '1000:1000');

    // Custom runtime (e.g., gVisor)
    if (definition.runtime) {
      args.push('--runtime', definition.runtime);
    }

    // Mount worktree (always included)
    args.push('-v', `${dockerWorktreePath}:/workspace:rw`);

    // Additional mounts from definition
    if (definition.mounts) {
      for (const mount of definition.mounts) {
        // Skip worktree mount if explicitly defined (we already added it)
        if (mount.target === '/workspace') {
          continue;
        }

        let sourcePath: string;
        if (mount.source.startsWith('./')) {
          // Relative to worktree
          const relPath = mount.source.slice(2);
          sourcePath = this.toDockerPath(
            this.system.joinPath(
              this.system.convertPath(worktreePath, 'nodeFs'),
              relPath
            )
          );
        } else if (mount.source.startsWith('~/')) {
          // Relative to home
          const relPath = mount.source.slice(2);
          sourcePath = this.toDockerPath(
            this.system.joinPath(this.system.getHomeDirectory(), relPath)
          );
        } else {
          sourcePath = this.toDockerPath(mount.source);
        }

        const mode = mount.readonly !== false ? 'ro' : 'rw';
        args.push('-v', `${sourcePath}:${mount.target}:${mode}`);
      }
    }

    // Environment variables
    if (definition.environment) {
      for (const [key, value] of Object.entries(definition.environment)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    // Pass Claude session ID for auto-start
    if (sessionId) {
      args.push('-e', `CLAUDE_SESSION_ID=${sessionId}`);
    }

    // Custom entrypoint
    if (definition.entrypoint && definition.entrypoint.length > 0) {
      args.push('--entrypoint', definition.entrypoint[0]);
      // Image and remaining entrypoint args
      args.push(definition.image);
      args.push(...definition.entrypoint.slice(1));
    } else {
      // Default: sleep infinity to keep container running
      args.push(definition.image, 'sleep', 'infinity');
    }

    this.logger?.debug(`Docker command: docker ${args.join(' ')}`);

    // Execute docker run
    const output = await this.system.exec(`docker ${args.join(' ')}`, '/tmp');
    const containerId = output.trim();
    this.logger?.debug(`Created container: ${containerId}`);
    return containerId;
  }

  async exec(containerId: string, command: string): Promise<string> {
    return this.system.exec(`docker exec ${containerId} ${command}`, '/tmp');
  }

  async destroy(containerId: string): Promise<void> {
    try {
      this.system.execSilent(`docker rm -f ${containerId}`, '/tmp');
      this.logger?.debug(`Destroyed container: ${containerId}`);
    } catch (e) {
      this.logger?.debug(`Failed to destroy container ${containerId}: ${e}`);
    }
  }

  async getStats(containerId: string): Promise<ContainerStats | null> {
    try {
      const output = this.system.execSync(
        `docker stats ${containerId} --no-stream --format "{{.MemUsage}},{{.CPUPerc}}"`,
        '/tmp'
      );

      // Parse "100MiB / 4GiB,5.00%"
      const [memPart, cpuPart] = output.trim().split(',');
      const memMatch = memPart.match(/^([\d.]+)([A-Za-z]+)/);
      const cpuMatch = cpuPart?.match(/^([\d.]+)%/);

      let memoryMB = 0;
      if (memMatch) {
        const value = parseFloat(memMatch[1]);
        const unit = memMatch[2].toLowerCase();
        if (unit.includes('gib') || unit.includes('gb')) {
          memoryMB = value * 1024;
        } else if (unit.includes('mib') || unit.includes('mb')) {
          memoryMB = value;
        } else if (unit.includes('kib') || unit.includes('kb')) {
          memoryMB = value / 1024;
        }
      }

      const cpuPercent = cpuMatch ? parseFloat(cpuMatch[1]) : 0;

      return { memoryMB, cpuPercent };
    } catch (e) {
      this.logger?.debug(`Failed to get container stats: ${e}`);
      return null;
    }
  }

  getShellCommand(containerId: string, _worktreePath: string): ShellCommand | null {
    // Use docker exec to get an interactive shell in the container
    return {
      shellPath: 'docker',
      shellArgs: ['exec', '-it', '-w', '/workspace', containerId, '/bin/bash'],
    };
  }

  /**
   * Load and parse a docker definition file.
   */
  private loadDefinition(definitionPath: string): DockerDefinition {
    const nodePath = this.system.convertPath(definitionPath, 'nodeFs');

    if (!this.system.exists(nodePath)) {
      throw new Error(`Docker definition file not found: ${definitionPath}`);
    }

    try {
      const content = this.system.readFile(nodePath);
      return JSON.parse(content) as DockerDefinition;
    } catch (e) {
      throw new Error(`Failed to parse docker definition: ${e}`);
    }
  }

  /**
   * Convert a path for Docker daemon access.
   * On Windows with Docker Desktop, C:/Users/... becomes /c/Users/...
   */
  private toDockerPath(inputPath: string): string {
    const nodePath = this.system.convertPath(inputPath, 'nodeFs');

    // Docker Desktop on Windows uses /c/... format
    // Convert C:/Users/... to /c/Users/...
    const match = nodePath.match(/^([A-Za-z]):[\\/](.*)$/);
    if (match) {
      return `/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
    }

    return nodePath;
  }

  async cleanupByWorktree(worktreePath: string): Promise<void> {
    try {
      // Find containers with the worktree label
      const output = this.system.execSync(
        `docker ps -aq --filter "label=opus-orchestra.worktree-path=${worktreePath}"`,
        '/tmp'
      );

      const containerIds = output.trim().split('\n').filter(id => id);
      for (const containerId of containerIds) {
        await this.destroy(containerId);
      }
    } catch {
      // Ignore errors during cleanup
    }
  }
}
