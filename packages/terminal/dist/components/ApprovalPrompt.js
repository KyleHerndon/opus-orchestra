import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
export function ApprovalPrompt({ description, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
onApprove, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
onReject, }) {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "\u2514\u2500 " }), _jsx(Text, { color: "yellow", bold: true, children: "\u26A0 Approval: " }), _jsx(Text, { children: description })] }), _jsxs(Box, { marginLeft: 3, children: [_jsx(Text, { dimColor: true, children: "   " }), _jsx(Text, { color: "cyan", children: "[a]" }), _jsx(Text, { children: " Allow  " }), _jsx(Text, { color: "cyan", children: "[r]" }), _jsx(Text, { children: " Reject  " }), _jsx(Text, { color: "cyan", children: "[v]" }), _jsx(Text, { children: " View details" })] })] }));
}
//# sourceMappingURL=ApprovalPrompt.js.map