/**
 * Svelte stores for webview state management
 *
 * The extension sends state updates via postMessage, which update these stores.
 * Svelte components subscribe to stores and re-render automatically.
 */

import { writable, derived } from 'svelte/store';

// ============================================================================
// Types
// ============================================================================

export interface TodoItem {
    status: 'pending' | 'in_progress' | 'completed';
    content: string;
    activeForm?: string;
}

export interface Agent {
    id: number;
    name: string;
    status: string;
    repoPath: string;
    sessionId: string;
    lastInteractionTime: number;
    diffStats: { insertions: number; deletions: number };
    containerConfigName?: string;
    containerInfo?: { state: string };
    pendingApproval?: string;
    hasTerminal: boolean;
    // Computed/derived
    todoItems: TodoItem[];
}

export interface ContainerOption {
    value: string;
    label: string;
}

export interface ContainerGroup {
    label: string;
    options: ContainerOption[];
}

export interface LoadingState {
    active: boolean;
    message: string;
    current?: number;
    total?: number;
}

export interface VersionInfo {
    version: string;
    branch: string;
    timestamp: string;
    dirty: boolean;
}

// ============================================================================
// Stores
// ============================================================================

/** All agents, keyed by ID for fast lookup */
export const agents = writable<Map<number, Agent>>(new Map());

/** Agents grouped by repository path */
export const agentsByRepo = derived(agents, ($agents) => {
    const grouped = new Map<string, Agent[]>();
    for (const agent of $agents.values()) {
        const list = grouped.get(agent.repoPath) || [];
        list.push(agent);
        grouped.set(agent.repoPath, list);
    }
    return grouped;
});

/** Repository paths (for empty repo sections) */
export const repoPaths = writable<string[]>([]);

/** Container configuration options */
export const containerGroups = writable<ContainerGroup[]>([]);

/** Loading indicator state */
export const loading = writable<LoadingState>({ active: false, message: '' });

/** UI scale factor */
export const uiScale = writable<number>(1.0);

/** Version info */
export const versionInfo = writable<VersionInfo>({ version: 'dev', branch: 'unknown', timestamp: '', dirty: true });

/** Dashboard stats (derived from agents) */
export const stats = derived(agents, ($agents) => {
    const agentList = Array.from($agents.values());
    return {
        total: agentList.length,
        working: agentList.filter(a => a.status === 'working').length,
        waiting: agentList.filter(a => a.status === 'waiting-input' || a.status === 'waiting-approval').length,
        containerized: agentList.filter(a => a.containerConfigName && a.containerConfigName !== 'unisolated').length,
        insertions: agentList.reduce((sum, a) => sum + a.diffStats.insertions, 0),
        deletions: agentList.reduce((sum, a) => sum + a.diffStats.deletions, 0),
    };
});

// ============================================================================
// Store Actions
// ============================================================================

/** Update a single agent's data (for incremental updates) */
export function updateAgent(id: number, data: Partial<Agent>): void {
    agents.update($agents => {
        const existing = $agents.get(id);
        if (existing) {
            // Create new Map to trigger Svelte 5 reactivity
            const newMap = new Map($agents);
            newMap.set(id, { ...existing, ...data });
            return newMap;
        }
        return $agents;
    });
}

/** Add a new agent */
export function addAgent(agent: Agent): void {
    agents.update($agents => {
        // Create new Map to trigger Svelte 5 reactivity
        const newMap = new Map($agents);
        newMap.set(agent.id, agent);
        return newMap;
    });
}

/** Remove an agent */
export function removeAgent(id: number): void {
    agents.update($agents => {
        // Create new Map to trigger Svelte 5 reactivity
        const newMap = new Map($agents);
        newMap.delete(id);
        return newMap;
    });
}

/** Set all agents (for initial load) */
export function setAgents(agentList: Agent[]): void {
    agents.set(new Map(agentList.map(a => [a.id, a])));
}

/** Swap agent positions (for drag-drop reorder) */
export function swapAgents(_sourceId: number, _targetId: number): void {
    // Note: This is handled via the agentsByRepo derived store
    // The actual order is determined by the agent's position in the list
    // For now, we'll rely on the extension to manage order
}
