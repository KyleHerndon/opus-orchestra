import * as vscode from 'vscode';
import { Agent, PersistedAgent } from '../types';
import { WorktreeManager } from './WorktreeManager';
import { ContainerManager } from '../containerManager';
import {
    getPersistenceService,
    isPersistenceServiceInitialized,
    getLogger,
    isLoggerInitialized,
} from '../services';

/**
 * Handles agent persistence to VS Code state and worktree metadata.
 * Responsible for saving and restoring agents across sessions.
 */
export class AgentPersistence {
    constructor(
        private worktreeManager: WorktreeManager,
        private containerManager: ContainerManager
    ) {}

    private debugLog(message: string): void {
        if (isLoggerInitialized()) {
            getLogger().child('AgentPersistence').debug(message);
        }
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
        // Save to VS Code workspace state
        if (isPersistenceServiceInitialized()) {
            getPersistenceService().saveAgents(agents);
        }

        // Save to worktree metadata files (source of truth)
        for (const agent of agents.values()) {
            this.worktreeManager.saveAgentMetadata(agent);
        }
    }

    /**
     * Restore agents from worktree metadata and VS Code state
     */
    restoreAgents(repoPaths: string[]): Map<number, Agent> {
        this.debugLog(`[restoreAgents] Starting agent restoration`);

        const agents = new Map<number, Agent>();

        // Scan worktrees for agents (source of truth)
        const worktreeAgents = new Map<string, PersistedAgent>();
        for (const repoPath of repoPaths) {
            const foundAgents = this.worktreeManager.scanWorktreesForAgents(repoPath);
            for (const agent of foundAgents) {
                worktreeAgents.set(agent.worktreePath, agent);
            }
        }

        this.debugLog(`[restoreAgents] Found ${worktreeAgents.size} agents in worktrees`);

        // Load from VS Code state as fallback
        let vscodeAgents: PersistedAgent[] = [];
        if (isPersistenceServiceInitialized()) {
            vscodeAgents = getPersistenceService().loadPersistedAgents();
            this.debugLog(`[restoreAgents] Found ${vscodeAgents.length} agents in VS Code state`);
        }

        // Merge: worktree metadata takes priority
        const allAgents = new Map<string, PersistedAgent>();

        // Add VS Code state agents first
        for (const agent of vscodeAgents) {
            allAgents.set(agent.worktreePath, agent);
        }

        // Override with worktree metadata
        for (const [path, agent] of worktreeAgents) {
            allAgents.set(path, agent);
        }

        // Log available terminals
        const terminalNames = vscode.window.terminals.map(t => t.name);
        this.debugLog(`[restoreAgents] Available terminals: ${JSON.stringify(terminalNames)}`);

        // Create Agent objects from persisted data
        for (const persisted of allAgents.values()) {
            const existingTerminal = vscode.window.terminals.find(
                t => t.name === persisted.name
            );

            const containerInfo = this.containerManager.getContainer(persisted.id);

            const agent: Agent = {
                ...persisted,
                sessionId: persisted.sessionId || this.generateSessionId(),
                terminal: existingTerminal || null,
                status: 'idle',
                statusIcon: existingTerminal ? 'circle-filled' : 'circle-outline',
                pendingApproval: null,
                lastInteractionTime: new Date(),
                diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
                containerInfo,
            };

            agents.set(agent.id, agent);
            this.debugLog(`[restoreAgents] Restored agent ${agent.name} (id=${agent.id})`);
        }

        this.debugLog(`[restoreAgents] Restored ${agents.size} total agents`);
        return agents;
    }
}
