/**
 * UI/webview-related types and utilities
 */

/**
 * Format a time duration since a given date
 * @param date The date to measure from
 * @param includeSuffix Whether to include "ago" suffix (default: false)
 */
export function formatTimeSince(date: Date, includeSuffix: boolean = false): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);

    const suffix = includeSuffix ? ' ago' : '';

    if (diffHour > 0) {
        return `${diffHour}h ${diffMin % 60}m${suffix}`;
    }
    if (diffMin > 0) {
        return `${diffMin}m${suffix}`;
    }
    return `${diffSec}s${suffix}`;
}

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
