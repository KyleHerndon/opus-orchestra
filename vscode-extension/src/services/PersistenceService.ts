/**
 * PersistenceService - Agent and container state persistence
 *
 * Handles saving and restoring agent/container state to VS Code workspace storage.
 */

import * as vscode from 'vscode';
import {
    Agent,
    PersistedAgent,
    DiffStats,
    AGENTS_STORAGE_KEY,
    ContainerInfo,
    PersistedContainerInfo,
    CONTAINERS_STORAGE_KEY,
} from '../types';
import { getLogger, isLoggerInitialized } from './Logger';

/**
 * Persistence service for agent state
 */
export class PersistenceService {
    private context: vscode.ExtensionContext | null = null;
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    /**
     * Set the extension context (required for persistence to work)
     */
    setContext(context: vscode.ExtensionContext): void {
        this.context = context;
    }

    /**
     * Check if persistence is available
     */
    isAvailable(): boolean {
        return this.context !== null;
    }

    // ========================================================================
    // Agent Persistence
    // ========================================================================

    /**
     * Get the storage key for persisted agents
     */
    private getAgentsStorageKey(): string {
        return AGENTS_STORAGE_KEY(this.workspaceRoot);
    }

    /**
     * Save agents to persistent storage
     */
    saveAgents(agents: Map<number, Agent>): void {
        if (!this.context) {
            return;
        }

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
                isolationTier: agent.isolationTier,
            });
        }

        this.context.workspaceState.update(this.getAgentsStorageKey(), persistedAgents);
    }

    /**
     * Load persisted agents from storage
     */
    loadPersistedAgents(): PersistedAgent[] {
        if (!this.context) {
            return [];
        }

        return this.context.workspaceState.get<PersistedAgent[]>(this.getAgentsStorageKey(), []);
    }

    /**
     * Restore agents from persistent storage
     *
     * @param generateSessionId Function to generate new session IDs for agents without one
     * @param getContainerInfo Function to get container info for an agent
     * @returns Map of restored agents
     */
    restoreAgents(
        generateSessionId: () => string,
        getContainerInfo: (agentId: number) => ContainerInfo | undefined
    ): Map<number, Agent> {
        const agents = new Map<number, Agent>();

        if (!this.context) {
            return agents;
        }

        const persistedAgents = this.loadPersistedAgents();

        // Log available terminals for debugging
        const terminalNames = vscode.window.terminals.map(t => t.name);
        this.log(`[restoreAgents] Available terminals: ${JSON.stringify(terminalNames)}`);

        for (const persisted of persistedAgents) {
            this.log(`[restoreAgents] Looking for terminal matching agent name: "${persisted.name}"`);

            // Try to find existing terminal for this agent
            const existingTerminal = vscode.window.terminals.find(
                t => t.name === persisted.name
            );

            this.log(`[restoreAgents] Found terminal: ${existingTerminal ? existingTerminal.name : 'none'}`);

            // Get container info if this agent is containerized
            const containerInfo = getContainerInfo(persisted.id);

            const agent: Agent = {
                ...persisted,
                // Generate sessionId for old agents that don't have one
                sessionId: persisted.sessionId || generateSessionId(),
                terminal: existingTerminal || null,
                status: 'idle',
                statusIcon: existingTerminal ? 'circle-filled' : 'circle-outline',
                pendingApproval: null,
                lastInteractionTime: new Date(),
                diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
                containerInfo,
            };

            agents.set(agent.id, agent);
        }

        return agents;
    }

    /**
     * Clear persisted agents
     */
    clearAgents(): void {
        if (this.context) {
            this.context.workspaceState.update(this.getAgentsStorageKey(), []);
        }
    }

    // ========================================================================
    // Container Persistence
    // ========================================================================

    /**
     * Save containers to persistent storage
     */
    saveContainers(containers: Map<number, ContainerInfo>): void {
        if (!this.context) {
            return;
        }

        const persisted: PersistedContainerInfo[] = [];
        for (const container of containers.values()) {
            persisted.push({
                id: container.id,
                tier: container.tier,
                agentId: container.agentId,
                worktreePath: container.worktreePath,
                proxyPort: container.proxyPort,
                createdAt: container.createdAt.toISOString(),
            });
        }

        this.context.workspaceState.update(CONTAINERS_STORAGE_KEY, persisted);
    }

    /**
     * Load persisted containers from storage
     */
    loadPersistedContainers(): PersistedContainerInfo[] {
        if (!this.context) {
            return [];
        }

        return this.context.workspaceState.get<PersistedContainerInfo[]>(CONTAINERS_STORAGE_KEY, []);
    }

    /**
     * Clear persisted containers
     */
    clearContainers(): void {
        if (this.context) {
            this.context.workspaceState.update(CONTAINERS_STORAGE_KEY, []);
        }
    }

    // ========================================================================
    // Utilities
    // ========================================================================

    /**
     * Internal logging
     */
    private log(message: string): void {
        if (isLoggerInitialized()) {
            getLogger().child('PersistenceService').debug(message);
        }
    }
}

/**
 * Singleton instance
 */
let persistenceServiceInstance: PersistenceService | null = null;

/**
 * Initialize the PersistenceService with workspace root
 */
export function initPersistenceService(workspaceRoot: string): PersistenceService {
    persistenceServiceInstance = new PersistenceService(workspaceRoot);
    return persistenceServiceInstance;
}

/**
 * Get the global PersistenceService instance
 */
export function getPersistenceService(): PersistenceService {
    if (!persistenceServiceInstance) {
        throw new Error('PersistenceService not initialized. Call initPersistenceService first.');
    }
    return persistenceServiceInstance;
}

/**
 * Check if PersistenceService is initialized
 */
export function isPersistenceServiceInitialized(): boolean {
    return persistenceServiceInstance !== null;
}

/**
 * Reset the global PersistenceService instance (for testing)
 */
export function resetPersistenceService(): void {
    persistenceServiceInstance = null;
}
