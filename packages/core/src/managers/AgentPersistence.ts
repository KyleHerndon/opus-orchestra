/**
 * AgentPersistence - Agent persistence and restoration
 *
 * Platform-agnostic implementation for saving/loading agent metadata.
 * Terminal reconnection is handled by UI-specific code.
 */

import { Agent, PersistedAgent } from '../types/agent';
import { IWorktreeManager } from './WorktreeManager';
import { StorageAdapter } from '../adapters/StorageAdapter';
import { ILogger } from '../services/Logger';

/**
 * Agent persistence interface
 */
export interface IAgentPersistence {
  generateSessionId(): string;
  saveAgents(agents: Map<number, Agent>): void;
  loadPersistedAgents(): PersistedAgent[];
  scanWorktreesForAgents(repoPaths: string[]): PersistedAgent[];
  mergeAgentSources(
    worktreeAgents: Map<string, PersistedAgent>,
    storageAgents: PersistedAgent[]
  ): Map<string, PersistedAgent>;
  removeAgentFromOrder(agentId: number, repoPath: string): void;
}

/**
 * Agent order map type for tracking display order per repository
 * Maps repoPath to array of agent IDs in display order
 */
export interface RepoAgentOrderMap {
  [repoPath: string]: number[];
}

/**
 * Handles agent persistence to storage and worktree metadata.
 * Responsible for saving and restoring agents across sessions.
 */
export class AgentPersistence implements IAgentPersistence {
  private worktreeManager: IWorktreeManager;
  private storage: StorageAdapter;
  private logger?: ILogger;

  constructor(
    worktreeManager: IWorktreeManager,
    storage: StorageAdapter,
    logger?: ILogger
  ) {
    this.worktreeManager = worktreeManager;
    this.storage = storage;
    this.logger = logger?.child('AgentPersistence');
  }

  /**
   * Generate a UUID for Claude session
   */
  generateSessionId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Save all agents to persistent storage
   */
  saveAgents(agents: Map<number, Agent>): void {
    // Save to storage adapter (VS Code workspace state, file, etc.)
    const persistedAgents: PersistedAgent[] = [];
    for (const agent of agents.values()) {
      persistedAgents.push({
        id: agent.id,
        name: agent.name,
        sessionId: agent.sessionId,
        branch: agent.branch,
        worktreePath: agent.worktreePath,
        repoPath: agent.repoPath,
        taskFile: agent.taskFile,
        containerConfigName: agent.containerConfigName,
        sessionStarted: agent.sessionStarted,
      });
    }
    this.storage.set('opus.agents', persistedAgents);

    // Save to worktree metadata files (source of truth)
    for (const agent of agents.values()) {
      this.worktreeManager.saveAgentMetadata(agent);
    }
  }

  /**
   * Load persisted agents from storage
   */
  loadPersistedAgents(): PersistedAgent[] {
    return this.storage.get<PersistedAgent[]>('opus.agents', []);
  }

  /**
   * Scan worktrees for agent metadata
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

  /**
   * Merge agents from worktree metadata and storage.
   * Worktree metadata takes priority as source of truth.
   */
  mergeAgentSources(
    worktreeAgents: Map<string, PersistedAgent>,
    storageAgents: PersistedAgent[]
  ): Map<string, PersistedAgent> {
    const merged = new Map<string, PersistedAgent>();

    // Add storage agents first
    for (const agent of storageAgents) {
      merged.set(agent.worktreePath, agent);
    }

    // Override with worktree metadata (source of truth)
    for (const [path, agent] of worktreeAgents) {
      merged.set(path, agent);
    }

    return merged;
  }

  /**
   * Remove an agent from the display order
   */
  removeAgentFromOrder(agentId: number, repoPath: string): void {
    const orderMap = this.storage.get<RepoAgentOrderMap>('opus.agentOrder', {});

    if (orderMap[repoPath]) {
      orderMap[repoPath] = orderMap[repoPath].filter(id => id !== agentId);
      if (orderMap[repoPath].length === 0) {
        delete orderMap[repoPath];
      }
      this.storage.set('opus.agentOrder', orderMap);
    }
  }

  /**
   * Get agent display order for a repository
   */
  getAgentOrder(repoPath: string): number[] {
    const orderMap = this.storage.get<RepoAgentOrderMap>('opus.agentOrder', {});
    return orderMap[repoPath] || [];
  }

  /**
   * Set agent display order for a repository
   */
  setAgentOrder(repoPath: string, order: number[]): void {
    const orderMap = this.storage.get<RepoAgentOrderMap>('opus.agentOrder', {});
    orderMap[repoPath] = order;
    this.storage.set('opus.agentOrder', orderMap);
  }
}
