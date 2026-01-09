import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * SettingsView - Configuration display and editing
 *
 * Shows current configuration values with ability to toggle/edit.
 */
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
// Mock settings for development
const SETTINGS = [
    {
        key: 'useTmux',
        label: 'Use Tmux',
        value: true,
        type: 'boolean',
        description: 'Enable tmux session management for persistent terminals',
    },
    {
        key: 'defaultAgentCount',
        label: 'Default Agent Count',
        value: 3,
        type: 'number',
        description: 'Number of agents to create by default',
    },
    {
        key: 'worktreeDirectory',
        label: 'Worktree Directory',
        value: '.worktrees',
        type: 'string',
        description: 'Directory for git worktrees',
    },
    {
        key: 'autoStartClaudeOnFocus',
        label: 'Auto-start Claude',
        value: true,
        type: 'boolean',
        description: 'Automatically start Claude when focusing an agent terminal',
    },
    {
        key: 'tmuxSessionPrefix',
        label: 'Tmux Session Prefix',
        value: 'opus',
        type: 'string',
        description: 'Prefix for tmux session names',
    },
    {
        key: 'diffPollingInterval',
        label: 'Diff Polling (ms)',
        value: 60000,
        type: 'number',
        description: 'How often to refresh diff statistics',
    },
    {
        key: 'isolationTier',
        label: 'Isolation Tier',
        value: 'standard',
        type: 'string',
        description: 'Container isolation level (standard, docker, gvisor)',
    },
];
export function SettingsView({ onBack }) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    useInput((input, key) => {
        if (key.escape || input === '1') {
            onBack();
            return;
        }
        if (key.upArrow) {
            setSelectedIndex((i) => Math.max(0, i - 1));
        }
        else if (key.downArrow) {
            setSelectedIndex((i) => Math.min(SETTINGS.length - 1, i + 1));
        }
        else if (key.return) {
            // Toggle boolean settings
            const setting = SETTINGS[selectedIndex];
            if (setting.type === 'boolean') {
                // In real implementation, would update config via adapter
                // For now, just visual feedback
            }
        }
    });
    const selectedSetting = SETTINGS[selectedIndex];
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { borderStyle: "single", borderColor: "blue", paddingX: 1, children: [_jsx(Text, { bold: true, color: "blue", children: "Settings" }), _jsx(Text, { children: " " }), _jsx(Text, { dimColor: true, children: "| Configuration options" })] }), _jsx(Box, { flexDirection: "column", paddingY: 1, children: SETTINGS.map((setting, index) => (_jsx(SettingRow, { setting: setting, selected: index === selectedIndex }, setting.key))) }), selectedSetting?.description && (_jsx(Box, { paddingX: 1, marginBottom: 1, children: _jsxs(Text, { dimColor: true, children: ["\u2139 ", selectedSetting.description] }) })), _jsxs(Box, { borderStyle: "single", borderColor: "gray", paddingX: 1, children: [_jsx(Text, { color: "cyan", children: "[\u2191\u2193]" }), _jsx(Text, { dimColor: true, children: " Navigate " }), _jsx(Text, { color: "cyan", children: "[Enter]" }), _jsx(Text, { dimColor: true, children: " Toggle " }), _jsx(Text, { color: "cyan", children: "[1/Esc]" }), _jsx(Text, { dimColor: true, children: " Back" })] })] }));
}
function SettingRow({ setting, selected }) {
    const formatValue = (value) => {
        if (typeof value === 'boolean') {
            return value ? 'On' : 'Off';
        }
        return String(value);
    };
    const valueColor = () => {
        if (typeof setting.value === 'boolean') {
            return setting.value ? 'green' : 'red';
        }
        return 'cyan';
    };
    return (_jsxs(Box, { paddingX: 1, children: [_jsx(Text, { color: selected ? 'cyan' : undefined, children: selected ? '> ' : '  ' }), _jsx(Box, { width: 25, children: _jsx(Text, { bold: selected, children: setting.label }) }), _jsx(Text, { color: valueColor(), children: formatValue(setting.value) })] }));
}
//# sourceMappingURL=SettingsView.js.map