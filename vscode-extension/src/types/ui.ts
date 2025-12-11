/**
 * UI/webview-related types
 */

/**
 * Agent panel message types (webview communication)
 */
export type AgentPanelMessageType =
    | 'refresh'
    | 'focusAgent'
    | 'startClaude'
    | 'stopAgent'
    | 'deleteAgent'
    | 'renameAgent'
    | 'showDiff'
    | 'respond'
    | 'approveAll'
    | 'createAgents'
    | 'cleanupAll'
    | 'openTerminal';

/**
 * Agent panel message structure
 */
export interface AgentPanelMessage {
    type: AgentPanelMessageType;
    agentId?: number;
    value?: string | number;
}
