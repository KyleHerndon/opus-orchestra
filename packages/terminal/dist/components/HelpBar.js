import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
export function HelpBar({ view = 'agents' }) {
    if (view === 'help') {
        return (_jsxs(Box, { borderStyle: "single", borderColor: "gray", paddingX: 1, children: [_jsx(Text, { dimColor: true, children: "Press " }), _jsx(Text, { color: "cyan", children: "?" }), _jsx(Text, { dimColor: true, children: " or " }), _jsx(Text, { color: "cyan", children: "Esc" }), _jsx(Text, { dimColor: true, children: " to close help" })] }));
    }
    if (view === 'diff') {
        return (_jsxs(Box, { borderStyle: "single", borderColor: "gray", paddingX: 1, children: [_jsx(Text, { color: "cyan", children: "[\u2191\u2193]" }), _jsx(Text, { dimColor: true, children: " Scroll " }), _jsx(Text, { color: "cyan", children: "[1]" }), _jsx(Text, { dimColor: true, children: " Back to list " }), _jsx(Text, { color: "cyan", children: "[q]" }), _jsx(Text, { dimColor: true, children: " Quit" })] }));
    }
    if (view === 'settings') {
        return (_jsxs(Box, { borderStyle: "single", borderColor: "gray", paddingX: 1, children: [_jsx(Text, { color: "cyan", children: "[\u2191\u2193]" }), _jsx(Text, { dimColor: true, children: " Navigate " }), _jsx(Text, { color: "cyan", children: "[Enter]" }), _jsx(Text, { dimColor: true, children: " Toggle " }), _jsx(Text, { color: "cyan", children: "[1]" }), _jsx(Text, { dimColor: true, children: " Back " }), _jsx(Text, { color: "cyan", children: "[q]" }), _jsx(Text, { dimColor: true, children: " Quit" })] }));
    }
    // Default: agents view
    return (_jsxs(Box, { borderStyle: "single", borderColor: "gray", paddingX: 1, flexWrap: "wrap", children: [_jsx(Text, { color: "cyan", children: "[\u2191\u2193]" }), _jsx(Text, { dimColor: true, children: " Nav " }), _jsx(Text, { color: "cyan", children: "[e/E]" }), _jsx(Text, { dimColor: true, children: " Expand " }), _jsx(Text, { color: "cyan", children: "[Enter]" }), _jsx(Text, { dimColor: true, children: " Focus " }), _jsx(Text, { color: "cyan", children: "[a]" }), _jsx(Text, { dimColor: true, children: " Approve " }), _jsx(Text, { color: "cyan", children: "[r]" }), _jsx(Text, { dimColor: true, children: " Reject " }), _jsx(Text, { color: "cyan", children: "[c]" }), _jsx(Text, { dimColor: true, children: " Create " }), _jsx(Text, { color: "cyan", children: "[x]" }), _jsx(Text, { dimColor: true, children: " Delete " }), _jsx(Text, { color: "cyan", children: "[d]" }), _jsx(Text, { dimColor: true, children: " Diff " }), _jsx(Text, { color: "cyan", children: "[s]" }), _jsx(Text, { dimColor: true, children: " Settings " }), _jsx(Text, { color: "cyan", children: "[?]" }), _jsx(Text, { dimColor: true, children: " Help " }), _jsx(Text, { color: "cyan", children: "[q]" }), _jsx(Text, { dimColor: true, children: " Quit" })] }));
}
//# sourceMappingURL=HelpBar.js.map