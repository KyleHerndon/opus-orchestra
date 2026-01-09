import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Root application component
 *
 * Manages view routing, agent state, and keyboard navigation.
 */
import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { AgentListView } from './views/AgentListView.js';
import { DiffView } from './views/DiffView.js';
import { SettingsView } from './views/SettingsView.js';
import { HelpBar } from './HelpBar.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { CreateAgentDialog } from './CreateAgentDialog.js';
import { useAgents } from '../hooks/useAgents.js';
export function App({ onFocusAgent }) {
    const { exit } = useApp();
    // Agent state from hook
    const { agents, stats, loading, error, approveAgent, rejectAgent, deleteAgent, createAgents, focusAgent, } = useAgents();
    // View state
    const [view, setView] = useState('agents');
    // Selection state
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [expandedIds, setExpandedIds] = useState(new Set());
    // Dialog state
    const [dialog, setDialog] = useState('none');
    // Get selected agent
    const selectedAgent = agents[selectedIndex];
    // Navigation helpers
    const selectNext = useCallback(() => {
        setSelectedIndex((i) => Math.min(i + 1, agents.length - 1));
    }, [agents.length]);
    const selectPrev = useCallback(() => {
        setSelectedIndex((i) => Math.max(i - 1, 0));
    }, []);
    const toggleExpand = useCallback(() => {
        if (!selectedAgent)
            return;
        setExpandedIds((ids) => {
            const newIds = new Set(ids);
            if (newIds.has(selectedAgent.id)) {
                newIds.delete(selectedAgent.id);
            }
            else {
                newIds.add(selectedAgent.id);
            }
            return newIds;
        });
    }, [selectedAgent]);
    const toggleExpandAll = useCallback(() => {
        setExpandedIds((ids) => {
            if (ids.size === agents.length) {
                return new Set();
            }
            else {
                return new Set(agents.map((a) => a.id));
            }
        });
    }, [agents]);
    // Action handlers
    const handleApprove = useCallback(() => {
        if (selectedAgent?.pendingApproval) {
            approveAgent(selectedAgent.id);
        }
    }, [selectedAgent, approveAgent]);
    const handleReject = useCallback(() => {
        if (selectedAgent?.pendingApproval) {
            rejectAgent(selectedAgent.id);
        }
    }, [selectedAgent, rejectAgent]);
    const handleFocus = useCallback(() => {
        if (selectedAgent) {
            if (onFocusAgent) {
                // Use callback to let CLI handle tmux attachment
                onFocusAgent(selectedAgent.name);
                exit();
            }
            else {
                // Fallback to direct focus (won't return to dashboard)
                focusAgent(selectedAgent.id);
            }
        }
    }, [selectedAgent, focusAgent, onFocusAgent, exit]);
    // Debug: log when onFocusAgent changes
    useEffect(() => {
        // eslint-disable-next-line no-console
        console.log('onFocusAgent prop:', onFocusAgent ? 'present' : 'missing');
    }, [onFocusAgent]);
    const handleDeleteConfirm = useCallback(() => {
        if (selectedAgent) {
            deleteAgent(selectedAgent.id);
        }
        setDialog('none');
    }, [selectedAgent, deleteAgent]);
    const handleCreateConfirm = useCallback((count) => {
        createAgents(count);
        setDialog('none');
    }, [createAgents]);
    // Handle keyboard input
    useInput((input, key) => {
        // If dialog is open, don't process other input
        if (dialog !== 'none') {
            return;
        }
        // Global: Quit
        if (input === 'q') {
            exit();
            return;
        }
        // Global: Help toggle
        if (input === '?') {
            setView((v) => (v === 'help' ? 'agents' : 'help'));
            return;
        }
        // View switching
        if (input === '1' || key.escape) {
            setView('agents');
            return;
        }
        if (input === '2' || (input === 'd' && view === 'agents')) {
            setView('diff');
            return;
        }
        if (input === '3' || input === 's') {
            setView('settings');
            return;
        }
        // Agent list navigation (only in agents view)
        if (view === 'agents') {
            if (key.upArrow) {
                selectPrev();
            }
            else if (key.downArrow) {
                selectNext();
            }
            else if (input === 'e') {
                toggleExpand();
            }
            else if (input === 'E') {
                toggleExpandAll();
            }
            else if (key.return) {
                handleFocus();
            }
            else if (input === 'c') {
                setDialog('create');
            }
            else if (input === 'x') {
                if (selectedAgent) {
                    setDialog('delete');
                }
            }
            else if (input === 'a') {
                handleApprove();
            }
            else if (input === 'r') {
                handleReject();
            }
        }
    });
    // Keep selection in bounds
    useEffect(() => {
        if (selectedIndex >= agents.length && agents.length > 0) {
            setSelectedIndex(agents.length - 1);
        }
    }, [agents.length, selectedIndex]);
    // Show error if any
    if (error) {
        return (_jsx(Box, { flexDirection: "column", padding: 1, children: _jsxs(Text, { color: "red", bold: true, children: ["Error: ", error] }) }));
    }
    return (_jsxs(Box, { flexDirection: "column", children: [dialog === 'delete' && selectedAgent && (_jsx(ConfirmDialog, { message: `Delete agent "${selectedAgent.name}"? This will remove the worktree and all changes.`, confirmLabel: "Delete", cancelLabel: "Cancel", onConfirm: handleDeleteConfirm, onCancel: () => setDialog('none') })), dialog === 'create' && (_jsx(CreateAgentDialog, { onConfirm: handleCreateConfirm, onCancel: () => setDialog('none') })), dialog === 'none' && (_jsxs(_Fragment, { children: [_jsxs(Box, { flexDirection: "column", minHeight: 10, children: [view === 'agents' && (_jsx(AgentListView, { agents: agents, stats: stats, selectedIndex: selectedIndex, expandedIds: expandedIds, onApprove: handleApprove, onReject: handleReject })), view === 'diff' && (_jsx(DiffView, { agent: selectedAgent, onBack: () => setView('agents') })), view === 'settings' && (_jsx(SettingsView, { onBack: () => setView('agents') })), view === 'help' && _jsx(HelpView, {})] }), loading && (_jsx(Box, { children: _jsx(Text, { color: "cyan", children: "Loading..." }) })), _jsx(HelpBar, { view: view })] }))] }));
}
function HelpView() {
    return (_jsxs(Box, { flexDirection: "column", padding: 1, children: [_jsx(Text, { color: "yellow", bold: true, children: "Keyboard Shortcuts" }), _jsx(Text, { children: " " }), _jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { children: _jsx(Text, { color: "cyan", bold: true, children: "Navigation" }) }), _jsxs(Text, { children: ["  ", _jsx(Text, { color: "cyan", children: "\u2191/\u2193" }), "     Navigate between agents"] }), _jsxs(Text, { children: ["  ", _jsx(Text, { color: "cyan", children: "Enter" }), "   Focus selected agent (attach tmux)"] }), _jsxs(Text, { children: ["  ", _jsx(Text, { color: "cyan", children: "e" }), "       Expand/collapse selected agent"] }), _jsxs(Text, { children: ["  ", _jsx(Text, { color: "cyan", children: "E" }), "       Expand/collapse all agents"] }), _jsx(Text, { children: " " }), _jsx(Text, { children: _jsx(Text, { color: "cyan", bold: true, children: "Actions" }) }), _jsxs(Text, { children: ["  ", _jsx(Text, { color: "cyan", children: "a" }), "       Approve pending action"] }), _jsxs(Text, { children: ["  ", _jsx(Text, { color: "cyan", children: "r" }), "       Reject pending action"] }), _jsxs(Text, { children: ["  ", _jsx(Text, { color: "cyan", children: "c" }), "       Create new agent"] }), _jsxs(Text, { children: ["  ", _jsx(Text, { color: "cyan", children: "x" }), "       Delete selected agent"] }), _jsx(Text, { children: " " }), _jsx(Text, { children: _jsx(Text, { color: "cyan", bold: true, children: "Views" }) }), _jsxs(Text, { children: ["  ", _jsx(Text, { color: "cyan", children: "d" }), " / ", _jsx(Text, { color: "cyan", children: "2" }), "   Switch to diff view"] }), _jsxs(Text, { children: ["  ", _jsx(Text, { color: "cyan", children: "s" }), " / ", _jsx(Text, { color: "cyan", children: "3" }), "   Switch to settings view"] }), _jsxs(Text, { children: ["  ", _jsx(Text, { color: "cyan", children: "1" }), " / ", _jsx(Text, { color: "cyan", children: "Esc" }), " Return to agent list"] }), _jsxs(Text, { children: ["  ", _jsx(Text, { color: "cyan", children: "?" }), "       Toggle this help"] }), _jsxs(Text, { children: ["  ", _jsx(Text, { color: "cyan", children: "q" }), "       Quit"] })] })] }));
}
//# sourceMappingURL=App.js.map