/**
 * Message types for communication between AgentPanel and webview
 */

import type { Agent } from '../agentManager';

// ============================================================================
// Messages FROM webview TO extension (user actions)
// ============================================================================

export interface WebviewIncomingMessage {
    command: string;
    agentId?: number;
    key?: string;
    text?: string;
    repoIndex?: number;
    containerConfigName?: string;
    count?: number;
    configName?: string;
    newName?: string;
    scale?: number;
    sourceAgentId?: number;
    targetAgentId?: number;
    repoPath?: string;
    dropPosition?: 'before' | 'after';
}

// ============================================================================
// Messages FROM extension TO webview (UI updates)
// ============================================================================

export interface TodoItemUpdate {
    status: 'pending' | 'in_progress' | 'completed';
    content: string;
    activeForm?: string;
}

export interface AgentUpdate {
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
    todoItems: TodoItemUpdate[];
}

export interface ContainerOption {
    value: string;
    label: string;
}

export interface ContainerGroup {
    label: string;
    options: ContainerOption[];
}

export interface VersionInfo {
    version: string;
    branch: string;
    timestamp: string;
    dirty: boolean;
}

export type WebviewOutgoingMessage =
    | { command: 'init'; agents: AgentUpdate[]; repoPaths: string[]; containerGroups: ContainerGroup[]; uiScale: number; versionInfo: VersionInfo }
    | { command: 'updateAgents'; agents: AgentUpdate[] }
    | { command: 'addCard'; agent: AgentUpdate }
    | { command: 'removeCard'; agentId: number }
    | { command: 'updateContainerOptions'; groups: ContainerGroup[] }
    | { command: 'loading'; active: boolean; message?: string; current?: number; total?: number }
    | { command: 'swapCards'; sourceAgentId: number; targetAgentId: number };

// ============================================================================
// Helpers
// ============================================================================

export function agentToUpdate(agent: Agent, todoItems: TodoItemUpdate[] = []): AgentUpdate {
    return {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        repoPath: agent.repoPath,
        sessionId: agent.sessionId,
        lastInteractionTime: agent.lastInteractionTime instanceof Date
            ? agent.lastInteractionTime.getTime()
            : agent.lastInteractionTime,
        diffStats: agent.diffStats,
        containerConfigName: agent.containerConfigName,
        containerInfo: agent.containerInfo,
        pendingApproval: agent.pendingApproval || undefined,
        hasTerminal: !!agent.terminal,
        todoItems,
    };
}
