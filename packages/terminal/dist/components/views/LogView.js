import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * LogView - Display application logs
 *
 * Shows the last N log entries with scrolling support.
 * Error/warn messages are captured from the LogStream.
 */
import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { isContainerInitialized, getContainer } from '../../services/ServiceContainer.js';
const MAX_VISIBLE_ENTRIES = 15;
export function LogView({ onBack }) {
    const [entries, setEntries] = useState([]);
    const [scrollOffset, setScrollOffset] = useState(0);
    // Load entries and subscribe to updates
    useEffect(() => {
        if (!isContainerInitialized()) {
            return;
        }
        const container = getContainer();
        const stream = container.uiLogStream;
        // Load existing entries
        // Note: LogStream doesn't persist to file, so we just show entries since startup
        const lastEntry = stream.getLastEntry();
        if (lastEntry) {
            setEntries([lastEntry]);
        }
        // Subscribe to new entries
        const handleEntry = (entry) => {
            setEntries((prev) => [...prev, entry]);
            // Auto-scroll to bottom
            setScrollOffset(Math.max(0, entries.length - MAX_VISIBLE_ENTRIES + 1));
        };
        stream.on('entry', handleEntry);
        return () => {
            stream.off('entry', handleEntry);
        };
    }, []);
    useInput((input, key) => {
        if (key.escape || input === '1') {
            onBack();
            return;
        }
        // Scroll
        if (key.upArrow) {
            setScrollOffset((o) => Math.max(0, o - 1));
        }
        else if (key.downArrow) {
            setScrollOffset((o) => Math.min(Math.max(0, entries.length - MAX_VISIBLE_ENTRIES), o + 1));
        }
        else if (key.pageUp) {
            setScrollOffset((o) => Math.max(0, o - MAX_VISIBLE_ENTRIES));
        }
        else if (key.pageDown) {
            setScrollOffset((o) => Math.min(Math.max(0, entries.length - MAX_VISIBLE_ENTRIES), o + MAX_VISIBLE_ENTRIES));
        }
    });
    const visibleEntries = entries.slice(scrollOffset, scrollOffset + MAX_VISIBLE_ENTRIES);
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { borderStyle: "single", borderColor: "blue", paddingX: 1, children: [_jsx(Text, { bold: true, color: "blue", children: "Log" }), _jsx(Text, { children: " " }), _jsxs(Text, { dimColor: true, children: ["| Error/Warning messages (", entries.length, " total)"] })] }), _jsx(Box, { flexDirection: "column", paddingY: 1, minHeight: MAX_VISIBLE_ENTRIES + 2, children: entries.length === 0 ? (_jsx(Box, { paddingX: 1, children: _jsx(Text, { dimColor: true, children: "No log entries yet." }) })) : (visibleEntries.map((entry, index) => (_jsx(LogEntryRow, { entry: entry }, scrollOffset + index)))) }), entries.length > MAX_VISIBLE_ENTRIES && (_jsx(Box, { paddingX: 1, children: _jsxs(Text, { dimColor: true, children: ["Showing ", scrollOffset + 1, "-", Math.min(scrollOffset + MAX_VISIBLE_ENTRIES, entries.length), " of ", entries.length] }) })), _jsxs(Box, { borderStyle: "single", borderColor: "gray", paddingX: 1, children: [_jsx(Text, { color: "cyan", children: "[\u2191\u2193]" }), _jsx(Text, { dimColor: true, children: " Scroll " }), _jsx(Text, { color: "cyan", children: "[PgUp/PgDn]" }), _jsx(Text, { dimColor: true, children: " Page " }), _jsx(Text, { color: "cyan", children: "[1/Esc]" }), _jsx(Text, { dimColor: true, children: " Back" })] })] }));
}
function LogEntryRow({ entry }) {
    const levelColor = entry.level === 'error' ? 'red' : 'yellow';
    const levelLabel = entry.level === 'error' ? 'ERR' : 'WRN';
    const time = entry.timestamp.toLocaleTimeString();
    return (_jsxs(Box, { paddingX: 1, children: [_jsxs(Text, { dimColor: true, children: ["[", time, "]"] }), _jsx(Text, { children: " " }), _jsxs(Text, { color: levelColor, bold: true, children: ["[", levelLabel, "]"] }), _jsx(Text, { children: " " }), _jsx(Text, { children: entry.message })] }));
}
//# sourceMappingURL=LogView.js.map