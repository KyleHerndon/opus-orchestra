import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * CreateAgentDialog - Dialog for creating new agents
 */
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
export function CreateAgentDialog({ onConfirm, onCancel, }) {
    const [count, setCount] = useState(1);
    useInput((input, key) => {
        if (key.escape) {
            onCancel();
            return;
        }
        if (key.return) {
            onConfirm(count);
            return;
        }
        if (key.upArrow) {
            setCount((c) => Math.min(c + 1, 10));
            return;
        }
        if (key.downArrow) {
            setCount((c) => Math.max(c - 1, 1));
            return;
        }
        // Number input
        const num = parseInt(input, 10);
        if (!isNaN(num) && num >= 1 && num <= 10) {
            setCount(num);
        }
    });
    return (_jsxs(Box, { flexDirection: "column", borderStyle: "double", borderColor: "cyan", paddingX: 2, paddingY: 1, children: [_jsx(Text, { color: "cyan", bold: true, children: "Create Agents" }), _jsx(Text, { children: " " }), _jsxs(Box, { children: [_jsx(Text, { children: "Number of agents: " }), _jsx(Text, { color: "cyan", bold: true, children: count })] }), _jsx(Text, { dimColor: true, children: "(Use \u2191/\u2193 or type 1-10)" }), _jsx(Text, { children: " " }), _jsxs(Box, { children: [_jsx(Text, { color: "cyan", children: "[Enter]" }), _jsx(Text, { children: " Create  " }), _jsx(Text, { color: "cyan", children: "[Esc]" }), _jsx(Text, { children: " Cancel" })] })] }));
}
//# sourceMappingURL=CreateAgentDialog.js.map