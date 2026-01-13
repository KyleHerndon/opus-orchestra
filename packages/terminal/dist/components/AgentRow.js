import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { isOk } from '@opus-orchestra/core';
import { StatusBadge } from './StatusBadge.js';
import { TodoList } from './TodoList.js';
import { ApprovalPrompt } from './ApprovalPrompt.js';
/**
 * Format time elapsed since last interaction
 */
function formatTime(date) {
    const now = Date.now();
    const elapsed = now - date.getTime();
    const seconds = Math.floor(elapsed / 1000);
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return `${hours}h`;
    }
    const days = Math.floor(hours / 24);
    return `${days}d`;
}
/**
 * Pad string to fixed width
 */
function pad(str, width) {
    if (str.length >= width) {
        return str.slice(0, width);
    }
    return str + ' '.repeat(width - str.length);
}
export function AgentRow({ agent, selected, expanded, onApprove, onReject, }) {
    const hasApproval = !!agent.pendingApproval;
    const hasTodos = agent.todos.length > 0;
    const todoSummary = hasTodos
        ? `(${agent.todos.filter((t) => t.status === 'completed').length}/${agent.todos.length} todos)`
        : '';
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { children: [_jsx(Text, { color: selected ? 'cyan' : undefined, children: selected ? '> ' : '  ' }), _jsx(Text, { bold: selected, color: selected ? 'cyan' : undefined, children: pad(agent.name, 10) }), _jsx(Box, { width: 18, children: _jsx(StatusBadge, { status: agent.status }) }), _jsx(Text, { dimColor: true, children: pad(agent.containerConfigName || 'unisolated', 12) }), isOk(agent.diffStats) ? (_jsxs(_Fragment, { children: [_jsxs(Text, { color: "green", children: ["+", agent.diffStats.data.insertions] }), _jsx(Text, { children: "/" }), _jsxs(Text, { color: "red", children: ["-", agent.diffStats.data.deletions] }), _jsx(Text, { children: " " })] })) : (_jsx(Text, { color: "yellow", dimColor: true, children: "[diff err] " })), _jsx(Text, { dimColor: true, children: pad(formatTime(agent.lastInteractionTime), 5) }), !expanded && todoSummary && (_jsxs(Text, { dimColor: true, children: [" ", todoSummary] })), hasApproval && !expanded && (_jsx(Text, { color: "yellow", children: " [!]" }))] }), expanded && (_jsxs(Box, { flexDirection: "column", marginLeft: 4, children: [hasTodos && (_jsx(TodoList, { todos: agent.todos })), hasApproval && (_jsx(ApprovalPrompt, { description: agent.pendingApproval, onApprove: onApprove, onReject: onReject }))] }))] }));
}
//# sourceMappingURL=AgentRow.js.map