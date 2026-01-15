/**
 * AgentFactory - Orchestrates agent creation
 *
 * Provides a centralized, platform-agnostic way to create agents.
 * Handles:
 * - Finding next available agent names
 * - Creating git worktrees
 * - Saving agent metadata
 * - Copying coordination files
 *
 * Platform-specific operations (terminal creation, container creation)
 * are handled via callbacks provided by the caller.
 */

import { randomUUID } from 'crypto';
import { Agent } from '../types/agent';
import { ContainerInfo } from '../types/container';
import { IWorktreeManager } from './WorktreeManager';
import { ILogger } from '../services/Logger';
import { SystemAdapter } from '../adapters/SystemAdapter';
import { getAvailableNames } from '../utils/agentNames';

/**
 * Result of agent creation
 */
export interface AgentCreationResult {
  /** Successfully created agents */
  created: Agent[];
  /** Errors that occurred during creation */
  errors: Array<{ name: string; error: string }>;
  /** Number of worktrees that were skipped (already existed) */
  skipped: number;
}

/**
 * Options for agent creation
 */
export interface AgentCreationOptions {
  /** Container config name (e.g., 'unisolated', 'docker') */
  containerConfigName?: string;

  /**
   * Callback to create a terminal for an agent.
   * Platform-specific (VS Code terminals, Ink terminals, etc.)
   * Called after worktree and metadata are created.
   */
  onCreateTerminal?: (agent: Agent) => void;

  /**
   * Callback to create a container for an agent.
   * Only called if containerConfigName is not 'unisolated'.
   * Returns container info on success, undefined on failure.
   */
  onCreateContainer?: (
    agent: Agent,
    configName: string
  ) => Promise<ContainerInfo | undefined>;

  /**
   * Path to extension/package for copying coordination files.
   * If not provided, coordination files are not copied.
   */
  extensionPath?: string;
}

/**
 * Interface for AgentFactory
 */
export interface IAgentFactory {
  /**
   * Create one or more agents.
   *
   * @param count - Number of agents to create
   * @param repoPath - Repository path to create agents in
   * @param options - Optional creation options
   * @returns Result containing created agents, errors, and skipped count
   */
  createAgents(
    count: number,
    repoPath: string,
    options?: AgentCreationOptions
  ): Promise<AgentCreationResult>;

  /**
   * Get the names of existing agents in a repository.
   */
  getExistingAgentNames(repoPath: string): Set<string>;

  /**
   * Generate a unique session ID for an agent.
   */
  generateSessionId(): string;
}

/**
 * AgentFactory implementation
 */
export class AgentFactory implements IAgentFactory {
  private worktreeManager: IWorktreeManager;
  private system: SystemAdapter;
  private logger?: ILogger;

  constructor(
    worktreeManager: IWorktreeManager,
    system: SystemAdapter,
    logger?: ILogger
  ) {
    this.worktreeManager = worktreeManager;
    this.system = system;
    this.logger = logger?.child({ component: 'AgentFactory' });
  }

  /**
   * Generate a unique session ID
   */
  generateSessionId(): string {
    return randomUUID();
  }

  /**
   * Get existing agent names from worktrees in a repository
   */
  getExistingAgentNames(repoPath: string): Set<string> {
    const agents = this.worktreeManager.scanWorktreesForAgents(repoPath);
    return new Set(agents.map(a => a.name));
  }

  /**
   * Create one or more agents
   */
  async createAgents(
    count: number,
    repoPath: string,
    options: AgentCreationOptions = {}
  ): Promise<AgentCreationResult> {
    const result: AgentCreationResult = {
      created: [],
      errors: [],
      skipped: 0,
    };

    if (count <= 0) {
      return result;
    }

    // Get current base branch
    const baseBranch = this.getBaseBranch(repoPath);
    if (!baseBranch) {
      result.errors.push({
        name: '',
        error: 'Could not determine base branch',
      });
      return result;
    }

    // Find existing agents and get available names
    const existingNames = this.getExistingAgentNames(repoPath);
    const existingAgents = this.worktreeManager.scanWorktreesForAgents(repoPath);
    const existingIds = new Set(existingAgents.map(a => a.id));

    // Get available names for the requested count
    const availableNames = getAvailableNames(existingNames, count);

    if (availableNames.length < count) {
      this.logger?.warn(
        `Could only generate ${availableNames.length} names out of ${count} requested`
      );
    }

    // Create agents
    for (const agentName of availableNames) {
      try {
        const agent = await this.createSingleAgent(
          agentName,
          repoPath,
          baseBranch,
          existingIds,
          options
        );

        if (agent) {
          result.created.push(agent);
          existingIds.add(agent.id);
        } else {
          result.skipped++;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push({ name: agentName, error: errorMessage });
        this.logger?.error(`Failed to create agent ${agentName}: ${errorMessage}`);
      }
    }

    this.logger?.info(
      `Created ${result.created.length} agents, skipped ${result.skipped}, errors ${result.errors.length}`
    );

    return result;
  }

  /**
   * Create a single agent
   */
  private async createSingleAgent(
    agentName: string,
    repoPath: string,
    baseBranch: string,
    existingIds: Set<number>,
    options: AgentCreationOptions
  ): Promise<Agent | null> {
    const branchName = `claude-${agentName}`;
    const worktreePath = this.worktreeManager.getWorktreePath(repoPath, agentName);

    // Skip if worktree already exists (restoration happens on startup, not during creation)
    if (this.worktreeManager.worktreeExists(worktreePath)) {
      this.logger?.debug(`Worktree already exists at ${worktreePath}, skipping`);
      return null;
    }

    // Create the worktree
    this.worktreeManager.createWorktree(repoPath, worktreePath, branchName, baseBranch);

    // Generate next available ID
    const agentId = this.getNextAgentId(existingIds);
    const sessionId = this.generateSessionId();

    // Create the agent object
    const agent: Agent = {
      id: agentId,
      name: agentName,
      sessionId,
      branch: branchName,
      worktreePath,
      repoPath,
      taskFile: null,
      terminal: null,
      status: 'idle',
      statusIcon: 'circle-outline',
      pendingApproval: null,
      lastInteractionTime: new Date(),
      diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
      todos: [],
      containerConfigName: options.containerConfigName || 'unisolated',
    };

    // Always copy coordination files (hooks, commands, scripts)
    // If extensionPath provided, use that; otherwise use core's bundled files
    this.worktreeManager.copyCoordinationFiles(agent, options.extensionPath);

    // Save agent metadata
    this.worktreeManager.saveAgentMetadata(agent);

    // Create container if not unisolated
    if (options.containerConfigName && options.containerConfigName !== 'unisolated') {
      if (options.onCreateContainer) {
        try {
          const containerInfo = await options.onCreateContainer(agent, options.containerConfigName);
          if (containerInfo) {
            agent.containerInfo = containerInfo;
          } else {
            // Container creation failed, fall back to unisolated
            this.logger?.warn(`Container creation failed for ${agentName}, running unisolated`);
            agent.containerConfigName = 'unisolated';
          }
        } catch (error) {
          this.logger?.warn(`Container creation error for ${agentName}: ${error}`);
          agent.containerConfigName = 'unisolated';
        }
      }
    }

    // Create terminal via callback
    if (options.onCreateTerminal) {
      options.onCreateTerminal(agent);
    }

    this.logger?.debug(`Created agent ${agentName} (id=${agentId})`);
    return agent;
  }

  /**
   * Get the current branch in the repository
   */
  private getBaseBranch(repoPath: string): string | null {
    try {
      const terminalPath = this.system.convertPath(repoPath, 'terminal');
      const result = this.system.execSync('git branch --show-current', terminalPath);
      return result.trim() || null;
    } catch (error) {
      this.logger?.error(`Failed to get base branch: ${error}`);
      return null;
    }
  }

  /**
   * Get the next available agent ID
   */
  private getNextAgentId(existingIds: Set<number>): number {
    let id = 1;
    while (existingIds.has(id)) {
      id++;
    }
    return id;
  }
}
