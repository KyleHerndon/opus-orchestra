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
import { isContainerInitialized, getContainer, } from '../services/ServiceContainer.js';
// Mock data for development (when ServiceContainer not initialized)
const MOCK_AGENTS = [
    {
        id: 1,
        name: 'alpha',
        status: 'working',
        repoPath: process.cwd(),
        branch: 'claude-alpha',
        diffStats: { insertions: 23, deletions: 5, filesChanged: 3 },
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
        diffStats: { insertions: 12, deletions: 3, filesChanged: 2 },
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
        diffStats: { insertions: 10, deletions: 4, filesChanged: 1 },
        containerConfigName: 'unisolated',
        todos: [],
        lastInteractionTime: new Date(Date.now() - 15 * 60 * 1000),
    },
];
/**
 * Convert PersistedAgent to TerminalAgent (for initial load)
 */
function persistedToTerminalAgent(persisted) {
    return {
        id: persisted.id,
        name: persisted.name,
        sessionId: persisted.sessionId,
        status: 'idle',
        repoPath: persisted.repoPath,
        branch: persisted.branch,
        diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
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
function scanWorktreeDirectories(repoPath, worktreeDir) {
    const agents = [];
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
            }
            catch {
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
                diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
                containerConfigName: 'unisolated',
                pendingApproval: null,
                todos: [],
                lastInteractionTime: new Date(),
            });
        }
    }
    catch {
        // Ignore errors
    }
    return agents;
}
function calculateStats(agents) {
    return {
        total: agents.length,
        working: agents.filter((a) => a.status === 'working').length,
        waiting: agents.filter((a) => a.status === 'waiting-input' || a.status === 'waiting-approval').length,
        containerized: agents.filter((a) => a.containerConfigName && a.containerConfigName !== 'unisolated').length,
        totalInsertions: agents.reduce((sum, a) => sum + a.diffStats.insertions, 0),
        totalDeletions: agents.reduce((sum, a) => sum + a.diffStats.deletions, 0),
    };
}
export function useAgents() {
    const [agents, setAgents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const containerRef = useRef(null);
    const terminalAdapterRef = useRef(null);
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
                    terminalAdapterRef.current = container.terminal;
                    // Load persisted agents
                    const persisted = container.persistence.loadPersistedAgents();
                    const terminalAgents = persisted.map(persistedToTerminalAgent);
                    // Also scan worktrees for any agents not in storage (with metadata)
                    const worktreeAgents = container.persistence.scanWorktreesForAgents([
                        process.cwd(),
                    ]);
                    // Merge worktree agents with metadata
                    const existingPaths = new Set(persisted.map((a) => a.worktreePath));
                    for (const wa of worktreeAgents) {
                        if (!existingPaths.has(wa.worktreePath)) {
                            terminalAgents.push(persistedToTerminalAgent(wa));
                        }
                    }
                    // ALSO scan for worktree directories directly (catches ones without metadata)
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
                }
                else {
                    // Use mock data for development
                    setAgents(MOCK_AGENTS);
                }
            }
            catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load agents');
                setAgents(MOCK_AGENTS); // Fall back to mock
            }
            finally {
                setLoading(false);
            }
        }
        initialize();
    }, []);
    // Core polling effect - uses AgentStatusTracker for all polling
    // Polling logic is shared between terminal and VSCode via core
    useEffect(() => {
        if (!containerRef.current) {
            return;
        }
        const container = containerRef.current;
        // Create a Map<number, Agent> from current agents for core's polling
        // This ref is updated when agents change, so polling always has current data
        const agentsMapRef = { current: new Map() };
        const updateAgentsMap = () => {
            agentsMapRef.current.clear();
            for (const agent of agents) {
                // Convert TerminalAgent to Agent for core compatibility
                const coreAgent = {
                    id: agent.id,
                    name: agent.name,
                    sessionId: agent.sessionId || randomUUID(),
                    branch: agent.branch,
                    worktreePath: container.worktreeManager.getWorktreePath(agent.repoPath, agent.name),
                    repoPath: agent.repoPath,
                    taskFile: null,
                    terminal: null,
                    status: agent.status,
                    statusIcon: 'circle-outline',
                    pendingApproval: agent.pendingApproval || null,
                    lastInteractionTime: agent.lastInteractionTime,
                    diffStats: agent.diffStats,
                    todos: agent.todos,
                    containerConfigName: agent.containerConfigName,
                };
                agentsMapRef.current.set(agent.id, coreAgent);
            }
        };
        // Initial map population
        updateAgentsMap();
        // Subscribe to events and sync changes back to React state
        const handleStatusChanged = ({ agent }) => {
            setAgents((prev) => prev.map((a) => a.id === agent.id
                ? {
                    ...a,
                    status: agent.status,
                    pendingApproval: agent.pendingApproval,
                    lastInteractionTime: new Date(),
                }
                : a));
        };
        const handleTodosChanged = ({ agent }) => {
            setAgents((prev) => prev.map((a) => a.id === agent.id
                ? { ...a, todos: agent.todos }
                : a));
        };
        const handleDiffStatsChanged = ({ agent }) => {
            setAgents((prev) => prev.map((a) => a.id === agent.id
                ? { ...a, diffStats: agent.diffStats }
                : a));
        };
        // Subscribe to events
        container.eventBus.on('agent:statusChanged', handleStatusChanged);
        container.eventBus.on('agent:todosChanged', handleTodosChanged);
        container.eventBus.on('agent:diffStatsChanged', handleDiffStatsChanged);
        // Start core polling
        container.statusTracker.startPolling(() => {
            updateAgentsMap();
            return agentsMapRef.current;
        }, {
            statusInterval: 1000,
            todoInterval: 2000,
            diffInterval: 60000,
        });
        return () => {
            container.statusTracker.stopPolling();
            container.eventBus.off('agent:statusChanged', handleStatusChanged);
            container.eventBus.off('agent:todosChanged', handleTodosChanged);
            container.eventBus.off('agent:diffStatsChanged', handleDiffStatsChanged);
        };
    }, [agents]); // Re-setup when agents change
    const refreshAgents = useCallback(async () => {
        if (!containerRef.current) {
            // Mock refresh - update timestamps
            setAgents((prev) => prev.map((a) => ({
                ...a,
                lastInteractionTime: new Date(),
            })));
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
                try {
                    const baseBranch = await container.gitService.getBaseBranch(agent.repoPath);
                    const worktreePath = container.worktreeManager.getWorktreePath(agent.repoPath, agent.name);
                    const diff = await container.gitService.getDiffStats(worktreePath, baseBranch);
                    agent.diffStats = diff;
                }
                catch {
                    // Ignore diff errors, keep default stats
                }
            }
            setAgents(terminalAgents);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to refresh');
        }
        finally {
            setLoading(false);
        }
    }, []);
    const approveAgent = useCallback(async (agentId) => {
        const agent = agents.find((a) => a.id === agentId);
        if (!agent?.pendingApproval)
            return;
        if (terminalAdapterRef.current) {
            try {
                // Find the terminal for this agent and send 'y' to approve
                const terminal = terminalAdapterRef.current.findByName(agent.name);
                if (terminal) {
                    terminalAdapterRef.current.sendText(terminal, 'y', true);
                }
            }
            catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to approve');
                return;
            }
        }
        // Update local state
        setAgents((prev) => prev.map((a) => a.id === agentId
            ? { ...a, pendingApproval: null, status: 'working' }
            : a));
    }, [agents]);
    const rejectAgent = useCallback(async (agentId) => {
        const agent = agents.find((a) => a.id === agentId);
        if (!agent?.pendingApproval)
            return;
        if (terminalAdapterRef.current) {
            try {
                // Find the terminal for this agent and send 'n' to reject
                const terminal = terminalAdapterRef.current.findByName(agent.name);
                if (terminal) {
                    terminalAdapterRef.current.sendText(terminal, 'n', true);
                }
            }
            catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to reject');
                return;
            }
        }
        // Update local state
        setAgents((prev) => prev.map((a) => a.id === agentId
            ? { ...a, pendingApproval: null, status: 'idle' }
            : a));
    }, [agents]);
    const deleteAgent = useCallback(async (agentId) => {
        const agent = agents.find((a) => a.id === agentId);
        if (!agent)
            return;
        setLoading(true);
        try {
            if (containerRef.current) {
                const container = containerRef.current;
                const worktreePath = container.worktreeManager.getWorktreePath(agent.repoPath, agent.name);
                // Kill tmux session if running (use sessionId-based naming)
                const sessionName = agent.sessionId
                    ? container.tmuxService.getSessionName(agent.sessionId)
                    : agent.name.replace(/[^a-zA-Z0-9-]/g, '-');
                container.tmuxService.killSession(sessionName);
                // Remove worktree
                container.worktreeManager.removeWorktree(agent.repoPath, worktreePath, agent.branch);
                // Remove from persistence (both opus.agents and opus.agentOrder)
                const existingAgents = container.persistence.loadPersistedAgents();
                const remainingAgents = existingAgents.filter((a) => a.id !== agentId);
                await container.storage.set('opus.agents', remainingAgents);
                container.persistence.removeAgentFromOrder(agentId, agent.repoPath);
            }
            // Update local state
            setAgents((prev) => prev.filter((a) => a.id !== agentId));
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete agent');
        }
        finally {
            setLoading(false);
        }
    }, [agents]);
    const createAgents = useCallback(async (count, repoPath) => {
        const targetRepo = repoPath ?? process.cwd();
        setLoading(true);
        try {
            if (containerRef.current) {
                const container = containerRef.current;
                const newAgents = [];
                // Get available names
                const usedNames = new Set(agents.map((a) => a.name));
                const availableNames = [
                    'delta', 'echo', 'foxtrot', 'golf', 'hotel',
                    'india', 'juliet', 'kilo', 'lima', 'mike',
                ].filter((n) => !usedNames.has(n));
                // Get base branch
                const baseBranch = await container.gitService.getBaseBranch(targetRepo);
                for (let i = 0; i < count && i < availableNames.length; i++) {
                    const name = availableNames[i];
                    const branch = `claude-${name}`;
                    const worktreePath = container.worktreeManager.getWorktreePath(targetRepo, name);
                    // Check if worktree already exists
                    if (!container.worktreeManager.worktreeExists(worktreePath)) {
                        // Create worktree (4 args: repoPath, worktreePath, branchName, baseBranch)
                        container.worktreeManager.createWorktree(targetRepo, worktreePath, branch, baseBranch);
                    }
                    // Generate ID and sessionId
                    const nextId = Math.max(0, ...agents.map((a) => a.id)) + 1 + i;
                    const sessionId = randomUUID();
                    const newAgent = {
                        id: nextId,
                        name,
                        sessionId,
                        status: 'idle',
                        repoPath: targetRepo,
                        branch,
                        diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
                        containerConfigName: 'unisolated',
                        todos: [],
                        lastInteractionTime: new Date(),
                    };
                    newAgents.push(newAgent);
                    // Create terminal (this creates the tmux session)
                    if (terminalAdapterRef.current) {
                        terminalAdapterRef.current.createTerminal({
                            name,
                            cwd: worktreePath,
                        });
                    }
                }
                // Persist new agents to storage so attachToAgentSession can find them
                // Include all fields matching PersistedAgent interface
                const existing = container.persistence.loadPersistedAgents();
                const maxExistingId = existing.length > 0
                    ? Math.max(...existing.map((a) => a.id || 0))
                    : 0;
                const toStore = newAgents.map((a, i) => {
                    const agentData = {
                        id: maxExistingId + 1 + i,
                        name: a.name,
                        sessionId: a.sessionId, // Use sessionId from newAgent
                        branch: a.branch,
                        worktreePath: container.worktreeManager.getWorktreePath(targetRepo, a.name),
                        repoPath: a.repoPath,
                        taskFile: null,
                        containerConfigName: a.containerConfigName,
                    };
                    // Create full agent object for coordination files and metadata
                    const agentForSetup = {
                        ...agentData,
                        terminal: null,
                        status: 'idle',
                        statusIcon: 'circle-outline',
                        pendingApproval: null,
                        lastInteractionTime: new Date(),
                        diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
                        todos: [],
                    };
                    // Copy coordination files (hooks, commands, scripts) from core
                    container.worktreeManager.copyCoordinationFiles(agentForSetup);
                    // Save agent metadata to worktree (.opus-orchestra/agent.json)
                    // This enables restoration and scanning of worktrees
                    container.worktreeManager.saveAgentMetadata(agentForSetup);
                    return agentData;
                });
                await container.storage.set('opus.agents', [...existing, ...toStore]);
                setAgents((prev) => [...prev, ...newAgents]);
            }
            else {
                // Mock create
                const names = ['delta', 'echo', 'foxtrot', 'golf', 'hotel'];
                const newAgents = [];
                for (let i = 0; i < count && i < names.length; i++) {
                    const nextId = Math.max(0, ...agents.map((a) => a.id)) + 1 + i;
                    newAgents.push({
                        id: nextId,
                        name: names[i],
                        status: 'idle',
                        repoPath: targetRepo,
                        branch: `claude-${names[i]}`,
                        diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
                        containerConfigName: 'unisolated',
                        todos: [],
                        lastInteractionTime: new Date(),
                    });
                }
                setAgents((prev) => [...prev, ...newAgents]);
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create agents');
        }
        finally {
            setLoading(false);
        }
    }, [agents]);
    const focusAgent = useCallback((agentId) => {
        const agent = agents.find((a) => a.id === agentId);
        if (!agent)
            return;
        if (terminalAdapterRef.current && containerRef.current) {
            // Use sessionId-based naming for stability across renames (matches VS Code extension)
            const sessionName = agent.sessionId
                ? containerRef.current.tmuxService.getSessionName(agent.sessionId)
                : agent.name.replace(/[^a-zA-Z0-9-]/g, '-');
            terminalAdapterRef.current.attachSession(sessionName);
        }
        else {
            // Mock focus
            console.log(`Would focus agent ${agent.name}`);
        }
    }, [agents]);
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
//# sourceMappingURL=useAgents.js.map