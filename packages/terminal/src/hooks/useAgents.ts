/**
 * useAgents - Hook for managing agent state
 *
 * Provides agent data and actions for the terminal UI.
 * Uses ServiceContainer when initialized, falls back to mock data for development.
 * Polling is handled by core's AgentStatusTracker.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TerminalAgent, DashboardStats } from '../types.js';
import {
  isContainerInitialized,
  getContainer,
  type ServiceContainer,
} from '../services/ServiceContainer.js';
import { getAvailableNames, ok, err, isOk, unwrapOr, type PersistedAgent, type Agent, type Result, type DiffStats } from '@opus-orchestra/core';
import { TmuxTerminalAdapter } from '../adapters/TmuxTerminalAdapter.js';

// Session naming is now handled by TmuxService.getAgentSessionName() - single source of truth

/**
 * Safely get the maximum agent ID from an array of agents.
 * Handles edge cases: empty arrays, non-numeric IDs, NaN values.
 * Returns 0 if no valid IDs are found.
 */
function getMaxAgentId(agents: Array<{ id: number }>): number {
  if (agents.length === 0) {
    return 0;
  }
  const validIds = agents
    .map((a) => a.id)
    .filter((id) => typeof id === 'number' && !Number.isNaN(id) && Number.isFinite(id));
  return validIds.length > 0 ? Math.max(...validIds) : 0;
}

// Mock data for development (when ServiceContainer not initialized)
const MOCK_AGENTS: TerminalAgent[] = [
  {
    id: 1,
    name: 'alpha',
    status: 'working',
    repoPath: process.cwd(),
    branch: 'claude-alpha',
    diffStats: ok({ insertions: 23, deletions: 5, filesChanged: 3 }),
    containerConfigName: 'docker',
    todos: [
      { status: 'completed', content: 'Setup project structure' },
      { status: 'in_progress', content: 'Implement feature X' },
      { status: 'pending', content: 'Write tests' },
    ],
    lastInteractionTime: new Date(Date.now() - 5 * 60 * 1000),
  },
  {
    id: 2,
    name: 'bravo',
    status: 'waiting-approval',
    repoPath: process.cwd(),
    branch: 'claude-bravo',
    diffStats: ok({ insertions: 12, deletions: 3, filesChanged: 2 }),
    containerConfigName: 'unisolated',
    pendingApproval: 'Write to /src/api.ts',
    todos: [
      { status: 'in_progress', content: 'Refactor API endpoints' },
    ],
    lastInteractionTime: new Date(Date.now() - 2 * 60 * 1000),
  },
  {
    id: 3,
    name: 'charlie',
    status: 'idle',
    repoPath: process.cwd(),
    branch: 'claude-charlie',
    diffStats: ok({ insertions: 10, deletions: 4, filesChanged: 1 }),
    containerConfigName: 'unisolated',
    todos: [],
    lastInteractionTime: new Date(Date.now() - 15 * 60 * 1000),
  },
];

/**
 * Convert PersistedAgent to TerminalAgent (for initial load)
 */
function persistedToTerminalAgent(persisted: PersistedAgent): TerminalAgent {
  return {
    id: persisted.id,
    name: persisted.name,
    sessionId: persisted.sessionId,
    status: 'idle',
    repoPath: persisted.repoPath,
    branch: persisted.branch,
    diffStats: ok({ insertions: 0, deletions: 0, filesChanged: 0 }),
    containerConfigName: persisted.containerConfigName,
    pendingApproval: null,
    todos: [],
    lastInteractionTime: new Date(),
  };
}

/**
 * Scan worktrees directory directly for any claude-* directories.
 * This catches worktrees that exist but don't have metadata files.
 */
function scanWorktreeDirectories(repoPath: string, worktreeDir: string): TerminalAgent[] {
  const agents: TerminalAgent[] = [];
  const worktreesPath = path.join(repoPath, worktreeDir);

  if (!fs.existsSync(worktreesPath)) {
    return agents;
  }

  try {
    const entries = fs.readdirSync(worktreesPath);

    for (const entry of entries) {
      // Only look at directories that look like agent worktrees
      if (!entry.startsWith('claude-')) {
        continue;
      }

      const entryPath = path.join(worktreesPath, entry);
      try {
        const stat = fs.statSync(entryPath);
        if (!stat.isDirectory()) {
          continue;
        }
      } catch (err) {
        // Log at debug level - stat failures are expected for inaccessible paths
        console.debug?.(`[opus-orchestra] Could not stat worktree entry ${entryPath}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      // Extract agent name from directory (claude-alpha -> alpha)
      const name = entry.replace('claude-', '');
      const branch = entry; // claude-alpha

      agents.push({
        id: agents.length + 1000, // Use high IDs to avoid conflicts
        name,
        status: 'idle',
        repoPath,
        branch,
        diffStats: ok({ insertions: 0, deletions: 0, filesChanged: 0 }),
        containerConfigName: 'unisolated',
        pendingApproval: null,
        todos: [],
        lastInteractionTime: new Date(),
      });
    }
  } catch (err) {
    // Log directory read errors - could indicate permission issues
    console.warn?.(`[opus-orchestra] Could not scan worktrees directory ${worktreesPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return agents;
}

function calculateStats(agents: TerminalAgent[]): DashboardStats {
  return {
    total: agents.length,
    working: agents.filter((a) => a.status === 'working').length,
    waiting: agents.filter((a) =>
      a.status === 'waiting-input' || a.status === 'waiting-approval'
    ).length,
    containerized: agents.filter((a) =>
      a.containerConfigName && a.containerConfigName !== 'unisolated'
    ).length,
    totalInsertions: agents.reduce((sum, a) => sum + (isOk(a.diffStats) ? a.diffStats.data.insertions : 0), 0),
    totalDeletions: agents.reduce((sum, a) => sum + (isOk(a.diffStats) ? a.diffStats.data.deletions : 0), 0),
  };
}

export interface UseAgentsResult {
  agents: TerminalAgent[];
  stats: DashboardStats;
  loading: boolean;
  error: string | null;

  // Actions
  refreshAgents: () => Promise<void>;
  approveAgent: (agentId: number) => Promise<void>;
  rejectAgent: (agentId: number) => Promise<void>;
  deleteAgent: (agentId: number) => Promise<void>;
  createAgents: (count: number, repoPath?: string) => Promise<void>;
  focusAgent: (agentId: number) => void;
}

export function useAgents(): UseAgentsResult {
  const [agents, setAgents] = useState<TerminalAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<ServiceContainer | null>(null);
  const terminalAdapterRef = useRef<TmuxTerminalAdapter | null>(null);

  const stats = calculateStats(agents);

  // Initialize - load agents from ServiceContainer or use mock data
  useEffect(() => {
    async function initialize() {
      setLoading(true);
      setError(null);

      try {
        if (isContainerInitialized()) {
          const container = getContainer();
          containerRef.current = container;

          // Cast terminal adapter to TmuxTerminalAdapter to access extended methods
          terminalAdapterRef.current = container.terminal as TmuxTerminalAdapter;

          // Load agents from worktree metadata (source of truth)
          const persisted = container.persistence.loadPersistedAgents();

          // Migrate legacy agents without sessionId and update their metadata
          for (const agent of persisted) {
            if (!agent.sessionId) {
              agent.sessionId = randomUUID();
              // Update worktree metadata with new sessionId
              container.worktreeManager.saveAgentMetadata({
                id: agent.id,
                name: agent.name,
                sessionId: agent.sessionId,
                branch: agent.branch,
                worktreePath: agent.worktreePath,
                repoPath: agent.repoPath,
                taskFile: agent.taskFile ?? null,
                containerConfigName: agent.containerConfigName,
                terminal: null,
                status: 'idle',
                statusIcon: 'circle-outline',
                pendingApproval: null,
                lastInteractionTime: new Date(),
                diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
                todos: [],
              });
            }
          }

          const terminalAgents = persisted.map(persistedToTerminalAgent);

          // Also scan for worktree directories without metadata (legacy worktrees)
          const worktreeDir = container.config.get('worktreeDirectory');
          const directoryAgents = scanWorktreeDirectories(process.cwd(), worktreeDir);

          // Merge directory agents, avoiding duplicates by name
          const existingNames = new Set(terminalAgents.map((a) => a.name));
          for (const da of directoryAgents) {
            if (!existingNames.has(da.name)) {
              terminalAgents.push(da);
            }
          }

          setAgents(terminalAgents);
        } else {
          // Use mock data for development
          setAgents(MOCK_AGENTS);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load agents');
        setAgents(MOCK_AGENTS); // Fall back to mock
      } finally {
        setLoading(false);
      }
    }

    initialize();
  }, []);

  // Track agents in a ref for polling access without causing effect re-runs
  const agentsRef = useRef<TerminalAgent[]>([]);
  agentsRef.current = agents;

  // Core polling effect - uses AgentStatusTracker for all polling
  // Polling logic is shared between terminal and VSCode via core
  // IMPORTANT: Empty dependency array - runs once on mount, cleanup on unmount
  // Uses agentsRef to access current agents without causing re-subscription
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const container = containerRef.current;

    // Create a Map<number, Agent> from current agents for core's polling
    const agentsMapRef = { current: new Map<number, Agent>() };

    // Function to update the agents map from current agentsRef
    const updateAgentsMap = () => {
      agentsMapRef.current.clear();
      for (const agent of agentsRef.current) {
        // sessionId should always exist after migration - don't generate new ones
        if (!agent.sessionId) {
          console.warn(`[opus-orchestra] Agent ${agent.name} missing sessionId - skipping`);
          continue;
        }
        // Convert TerminalAgent to Agent for core compatibility
        const coreAgent: Agent = {
          id: agent.id,
          name: agent.name,
          sessionId: agent.sessionId,
          branch: agent.branch,
          worktreePath: container.worktreeManager.getWorktreePath(agent.repoPath, agent.name),
          repoPath: agent.repoPath,
          taskFile: null,
          terminal: null,
          status: agent.status,
          statusIcon: 'circle-outline',
          pendingApproval: agent.pendingApproval || null,
          lastInteractionTime: agent.lastInteractionTime,
          diffStats: unwrapOr(agent.diffStats, { insertions: 0, deletions: 0, filesChanged: 0 }),
          todos: agent.todos,
          containerConfigName: agent.containerConfigName,
        };
        agentsMapRef.current.set(agent.id, coreAgent);
      }
    };

    // Event handlers - use setAgents functional updates for latest state
    const handleStatusChanged = ({ agent }: { agent: Agent }) => {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === agent.id
            ? {
                ...a,
                status: agent.status,
                pendingApproval: agent.pendingApproval,
                lastInteractionTime: new Date(),
              }
            : a
        )
      );
    };

    const handleTodosChanged = ({ agent }: { agent: Agent }) => {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === agent.id
            ? { ...a, todos: agent.todos }
            : a
        )
      );
    };

    const handleDiffStatsChanged = ({ agent }: { agent: Agent }) => {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === agent.id
            ? { ...a, diffStats: ok(agent.diffStats) }
            : a
        )
      );
    };

    // Subscribe to events (once)
    container.eventBus.on('agent:statusChanged', handleStatusChanged);
    container.eventBus.on('agent:todosChanged', handleTodosChanged);
    container.eventBus.on('agent:diffStatsChanged', handleDiffStatsChanged);

    // Callback to apply agent updates from the status tracker
    // Updates both the ref map and React state
    const handleAgentUpdate = (agentId: number, updatedAgent: Agent) => {
      // Update the ref map
      agentsMapRef.current.set(agentId, updatedAgent);
      // Note: React state is updated via event handlers above
    };

    // Start core polling with a getter that reads from agentsRef
    container.statusTracker.startPolling(
      () => {
        updateAgentsMap();
        return agentsMapRef.current;
      },
      handleAgentUpdate,
      {
        statusInterval: 1000,
        todoInterval: 2000,
        diffInterval: 60000,
      }
    );

    // Cleanup on unmount - stop polling and unsubscribe from all events
    return () => {
      container.statusTracker.stopPolling();
      container.eventBus.off('agent:statusChanged', handleStatusChanged);
      container.eventBus.off('agent:todosChanged', handleTodosChanged);
      container.eventBus.off('agent:diffStatsChanged', handleDiffStatsChanged);
    };
  }, []); // Empty deps - run once on mount, cleanup on unmount

  const refreshAgents = useCallback(async () => {
    if (!containerRef.current) {
      // Mock refresh - update timestamps
      setAgents((prev) =>
        prev.map((a) => ({
          ...a,
          lastInteractionTime: new Date(),
        }))
      );
      return;
    }

    setLoading(true);
    try {
      const container = containerRef.current;

      // Reload from persistence
      const persisted = container.persistence.loadPersistedAgents();
      const terminalAgents = persisted.map(persistedToTerminalAgent);

      // Get diff stats for each agent
      for (const agent of terminalAgents) {
        const baseBranch = await container.gitService.getBaseBranch(agent.repoPath);
        const worktreePath = container.worktreeManager.getWorktreePath(
          agent.repoPath,
          agent.name
        );
        agent.diffStats = await container.gitService.getDiffStatsResult(worktreePath, baseBranch);
      }

      setAgents(terminalAgents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh');
    } finally {
      setLoading(false);
    }
  }, []);

  const approveAgent = useCallback(async (agentId: number) => {
    const agent = agentsRef.current.find((a) => a.id === agentId);
    if (!agent?.pendingApproval) {return;}

    if (terminalAdapterRef.current) {
      try {
        // Find the terminal for this agent and send 'y' to approve
        const terminal = terminalAdapterRef.current.findByName(agent.name);
        if (terminal) {
          terminalAdapterRef.current.sendText(terminal, 'y', true);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to approve'
        );
        return;
      }
    }

    // Update local state
    setAgents((prev) =>
      prev.map((a) =>
        a.id === agentId
          ? { ...a, pendingApproval: null, status: 'working' as const }
          : a
      )
    );
  }, []);

  const rejectAgent = useCallback(async (agentId: number) => {
    const agent = agentsRef.current.find((a) => a.id === agentId);
    if (!agent?.pendingApproval) {return;}

    if (terminalAdapterRef.current) {
      try {
        // Find the terminal for this agent and send 'n' to reject
        const terminal = terminalAdapterRef.current.findByName(agent.name);
        if (terminal) {
          terminalAdapterRef.current.sendText(terminal, 'n', true);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to reject'
        );
        return;
      }
    }

    // Update local state
    setAgents((prev) =>
      prev.map((a) =>
        a.id === agentId
          ? { ...a, pendingApproval: null, status: 'idle' as const }
          : a
      )
    );
  }, []);

  const deleteAgent = useCallback(async (agentId: number) => {
    const agent = agentsRef.current.find((a) => a.id === agentId);
    if (!agent) {return;}

    setLoading(true);
    try {
      if (containerRef.current) {
        const container = containerRef.current;
        const worktreePath = container.worktreeManager.getWorktreePath(
          agent.repoPath,
          agent.name
        );

        // Kill tmux session if running
        const sessionName = container.tmuxService.getAgentSessionName(agent);
        container.tmuxService.killSession(sessionName);

        // Remove worktree (this also removes .opus-orchestra/agent.json metadata)
        // ARCHITECTURE: Worktree-only persistence - removing the worktree
        // removes all agent state. No central storage cleanup needed.
        container.worktreeManager.removeWorktree(
          agent.repoPath,
          worktreePath,
          agent.branch
        );
      }

      // Update local state
      setAgents((prev) => prev.filter((a) => a.id !== agentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete agent');
    } finally {
      setLoading(false);
    }
  }, []);

  const createAgents = useCallback(async (count: number, repoPath?: string) => {
    const targetRepo = repoPath ?? process.cwd();

    setLoading(true);
    try {
      if (containerRef.current) {
        const container = containerRef.current;
        const newAgents: TerminalAgent[] = [];

        // Get available names using generator that supports unlimited names (alpha-alpha, etc.)
        const usedNames = new Set(agentsRef.current.map((a) => a.name));
        const availableNames = getAvailableNames(usedNames, count);

        // Get base branch
        const baseBranch = await container.gitService.getBaseBranch(targetRepo);

        for (let i = 0; i < count && i < availableNames.length; i++) {
          const name = availableNames[i];
          const branch = `claude-${name}`;
          const worktreePath = container.worktreeManager.getWorktreePath(
            targetRepo,
            name
          );

          // Check if worktree already exists
          if (!container.worktreeManager.worktreeExists(worktreePath)) {
            // Create worktree (4 args: repoPath, worktreePath, branchName, baseBranch)
            container.worktreeManager.createWorktree(
              targetRepo,
              worktreePath,
              branch,
              baseBranch
            );
          }

          // Generate ID and sessionId (use safe helper to handle edge cases)
          const nextId = getMaxAgentId(agentsRef.current) + 1 + i;
          const sessionId = randomUUID();

          const newAgent: TerminalAgent = {
            id: nextId,
            name,
            sessionId,
            status: 'idle',
            repoPath: targetRepo,
            branch,
            diffStats: ok({ insertions: 0, deletions: 0, filesChanged: 0 }),
            containerConfigName: 'unisolated',
            todos: [],
            lastInteractionTime: new Date(),
          };

          newAgents.push(newAgent);

          // Create terminal (this creates the tmux session)
          // Pass sessionId for stable session naming across renames
          if (terminalAdapterRef.current) {
            terminalAdapterRef.current.createTerminal({
              name,
              sessionId,
              cwd: worktreePath,
            });
          }
        }

        // ARCHITECTURE: Worktree-only persistence - save agent metadata to
        // worktree directory. No central storage is used for agent data.
        for (const a of newAgents) {
          const agentForSetup = {
            id: a.id,
            name: a.name,
            sessionId: a.sessionId!,
            branch: a.branch,
            worktreePath: container.worktreeManager.getWorktreePath(targetRepo, a.name),
            repoPath: a.repoPath,
            taskFile: null,
            containerConfigName: a.containerConfigName,
            terminal: null,
            status: 'idle' as const,
            statusIcon: 'circle-outline' as const,
            pendingApproval: null,
            lastInteractionTime: new Date(),
            diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
            todos: [],
          };

          // Copy coordination files (hooks, commands, scripts) from core
          container.worktreeManager.copyCoordinationFiles(agentForSetup);

          // Save agent metadata to worktree (.opus-orchestra/agent.json)
          container.worktreeManager.saveAgentMetadata(agentForSetup);
        }

        setAgents((prev) => [...prev, ...newAgents]);
      } else {
        // Mock create - use name generator that supports unlimited names
        const usedNames = new Set(agentsRef.current.map((a) => a.name));
        const availableNames = getAvailableNames(usedNames, count);
        const newAgents: TerminalAgent[] = [];

        for (let i = 0; i < availableNames.length; i++) {
          const nextId = getMaxAgentId(agentsRef.current) + 1 + i;
          newAgents.push({
            id: nextId,
            name: availableNames[i],
            status: 'idle',
            repoPath: targetRepo,
            branch: `claude-${availableNames[i]}`,
            diffStats: ok({ insertions: 0, deletions: 0, filesChanged: 0 }),
            containerConfigName: 'unisolated',
            todos: [],
            lastInteractionTime: new Date(),
          });
        }

        setAgents((prev) => [...prev, ...newAgents]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agents');
    } finally {
      setLoading(false);
    }
  }, []);

  const focusAgent = useCallback((agentId: number) => {
    const agent = agentsRef.current.find((a) => a.id === agentId);
    if (!agent) {return;}

    if (terminalAdapterRef.current && containerRef.current) {
      const sessionName = containerRef.current.tmuxService.getAgentSessionName(agent);
      terminalAdapterRef.current.attachSession(sessionName);
    }
    // else: Mock mode - no terminal adapter available, nothing to focus
  }, []);

  return {
    agents,
    stats,
    loading,
    error,
    refreshAgents,
    approveAgent,
    rejectAgent,
    deleteAgent,
    createAgents,
    focusAgent,
  };
}
