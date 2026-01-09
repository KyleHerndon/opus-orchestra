/**
 * AgentRow - Single agent row display (expandable)
 *
 * Displays agent info on a single line with optional expansion
 * for todos and approval prompts.
 */
import React from 'react';
import type { TerminalAgent } from '../types.js';
interface AgentRowProps {
    agent: TerminalAgent;
    selected: boolean;
    expanded: boolean;
    onApprove?: () => void;
    onReject?: () => void;
}
export declare function AgentRow({ agent, selected, expanded, onApprove, onReject, }: AgentRowProps): React.ReactElement;
export {};
//# sourceMappingURL=AgentRow.d.ts.map