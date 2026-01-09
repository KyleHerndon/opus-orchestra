import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, useInput } from 'ink';
export function ConfirmDialog({ message, confirmLabel = 'Yes', cancelLabel = 'No', onConfirm, onCancel, }) {
    useInput((input, key) => {
        if (input === 'y' || input === 'Y' || key.return) {
            onConfirm();
        }
        else if (input === 'n' || input === 'N' || key.escape) {
            onCancel();
        }
    });
    return (_jsxs(Box, { flexDirection: "column", borderStyle: "double", borderColor: "yellow", paddingX: 2, paddingY: 1, children: [_jsx(Text, { color: "yellow", bold: true, children: "Confirm" }), _jsx(Text, { children: " " }), _jsx(Text, { children: message }), _jsx(Text, { children: " " }), _jsxs(Box, { children: [_jsx(Text, { color: "cyan", children: "[y]" }), _jsxs(Text, { children: [" ", confirmLabel, "  "] }), _jsx(Text, { color: "cyan", children: "[n]" }), _jsxs(Text, { children: [" ", cancelLabel] })] })] }));
}
//# sourceMappingURL=ConfirmDialog.js.map