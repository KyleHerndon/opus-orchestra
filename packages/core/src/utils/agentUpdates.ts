/**
 * Immutable Agent Update Utilities
 *
 * Provides helpers for creating updated agent objects without mutation.
 * This prevents race conditions where UI reads partial updates.
 *
 * Pattern: Always create a new agent object with the updates applied,
 * then atomically replace it in the agents map.
 */

import { Agent, AgentStatus, DiffStats, AgentTodoItem } from '../types/agent';

/**
 * Partial agent update - only the fields being changed
 */
export interface AgentUpdate {
  status?: AgentStatus;
  statusIcon?: string;
  pendingApproval?: string | null;
  diffStats?: DiffStats;
  todos?: AgentTodoItem[];
  lastInteractionTime?: Date;
}

/**
 * Create an updated agent with new values applied immutably.
 * Returns a new agent object; the original is not modified.
 *
 * @param agent - Original agent
 * @param updates - Partial updates to apply
 * @returns New agent object with updates applied
 */
export function updateAgent(agent: Agent, updates: AgentUpdate): Agent {
  return {
    ...agent,
    ...updates,
    // Deep copy mutable nested objects to prevent shared references
    diffStats: updates.diffStats
      ? { ...updates.diffStats }
      : { ...agent.diffStats },
    todos: updates.todos
      ? updates.todos.map(t => ({ ...t }))
      : agent.todos.map(t => ({ ...t })),
  };
}

/**
 * Create an agent with updated status and icon.
 * Convenience wrapper for the common status update pattern.
 */
export function updateAgentStatus(
  agent: Agent,
  status: AgentStatus,
  statusIcon: string,
  pendingApproval: string | null
): Agent {
  return updateAgent(agent, {
    status,
    statusIcon,
    pendingApproval,
    lastInteractionTime: new Date(),
  });
}

/**
 * Create an agent with updated diff stats.
 */
export function updateAgentDiffStats(agent: Agent, diffStats: DiffStats): Agent {
  return updateAgent(agent, { diffStats });
}

/**
 * Create an agent with updated todos.
 */
export function updateAgentTodos(agent: Agent, todos: AgentTodoItem[]): Agent {
  return updateAgent(agent, { todos });
}

/**
 * Atomically update an agent in a map.
 * Creates a new agent object and replaces the old one in the map.
 *
 * @param agents - The agents map to update
 * @param agentId - ID of the agent to update
 * @param updates - Updates to apply
 * @returns The updated agent, or undefined if not found
 */
export function updateAgentInMap(
  agents: Map<number, Agent>,
  agentId: number,
  updates: AgentUpdate
): Agent | undefined {
  const agent = agents.get(agentId);
  if (!agent) {
    return undefined;
  }

  const updatedAgent = updateAgent(agent, updates);
  agents.set(agentId, updatedAgent);
  return updatedAgent;
}

/**
 * Create a snapshot of the agents map for safe iteration.
 * Returns an array of agents that won't be affected by map modifications.
 */
export function snapshotAgents(agents: Map<number, Agent>): Agent[] {
  return Array.from(agents.values());
}

/**
 * Create a snapshot map (shallow copy) for iteration.
 * Modifications to the original map won't affect iteration.
 */
export function snapshotAgentsMap(agents: Map<number, Agent>): Map<number, Agent> {
  return new Map(agents);
}

/**
 * Check if two DiffStats are equal
 */
export function diffStatsEqual(a: DiffStats, b: DiffStats): boolean {
  return (
    a.insertions === b.insertions &&
    a.deletions === b.deletions &&
    a.filesChanged === b.filesChanged
  );
}

/**
 * Check if two todo arrays are equal
 */
export function todosEqual(a: AgentTodoItem[], b: AgentTodoItem[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].status !== b[i].status ||
      a[i].content !== b[i].content ||
      a[i].activeForm !== b[i].activeForm
    ) {
      return false;
    }
  }
  return true;
}
