/**
 * AgentPersistence - Agent persistence and restoration
 *
 * ARCHITECTURE: All agent state is stored in worktree metadata only.
 * No central storage is used for agent data. This ensures:
 * - Agents are discoverable by scanning worktrees
 * - Deleting a worktree removes all associated state
 * - No orphaned state in central storage
 *
 * Platform-agnostic implementation for saving/loading agent metadata.
 * Terminal reconnection is handled by UI-specific code.
 */

import { randomUUID } from 'node:crypto';
import { Agent, PersistedAgent } from '../types/agent';
import { IWorktreeManager } from './WorktreeManager';
import { ILogger } from '../services/Logger';

/**
 * Agent persistence interface
 */
export interface IAgentPersistence {
  generateSessionId(): string;
  saveAgents(agents: Map<number, Agent>): void;
  loadPersistedAgents(): PersistedAgent[];
  scanWorktreesForAgents(repoPaths: string[]): PersistedAgent[];
}

/**
 * Handles agent persistence via worktree metadata files.
 * All state is stored in each worktree's .opus-orchestra/agent.json.
 * No central storage is used - this is an architectural invariant.
 */
export class AgentPersistence implements IAgentPersistence {
  private worktreeManager: IWorktreeManager;
  private repoPath: string;
  private logger?: ILogger;

  constructor(
    worktreeManager: IWorktreeManager,
    repoPath: string,
    logger?: ILogger
  ) {
    this.worktreeManager = worktreeManager;
    this.repoPath = repoPath;
    this.logger = logger?.child({ component: 'AgentPersistence' });
  }

  /**
   * Generate a UUID for Claude session using cryptographically secure random bytes
   */
  generateSessionId(): string {
    return randomUUID();
  }

  /**
   * Save all agents to worktree metadata files.
   * ARCHITECTURE: No central storage is used.
   */
  saveAgents(agents: Map<number, Agent>): void {
    for (const agent of agents.values()) {
      this.worktreeManager.saveAgentMetadata(agent);
    }
    this.logger?.debug(`Saved ${agents.size} agents to worktree metadata`);
  }

  /**
   * Load persisted agents by scanning worktrees.
   * ARCHITECTURE: Agents are discovered from worktree metadata only.
   */
  loadPersistedAgents(): PersistedAgent[] {
    const agents = this.worktreeManager.scanWorktreesForAgents(this.repoPath);
    this.logger?.debug(`Loaded ${agents.length} agents from worktrees`);
    return agents;
  }

  /**
   * Scan worktrees for agent metadata.
   * @deprecated Use loadPersistedAgents() instead - this method exists for interface compatibility.
   */
  scanWorktreesForAgents(repoPaths: string[]): PersistedAgent[] {
    const agents: PersistedAgent[] = [];

    for (const repoPath of repoPaths) {
      const foundAgents = this.worktreeManager.scanWorktreesForAgents(repoPath);
      agents.push(...foundAgents);
    }

    this.logger?.debug(`Found ${agents.length} agents in worktrees`);
    return agents;
  }
}
