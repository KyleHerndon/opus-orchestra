import { jsx as _jsx } from "react/jsx-runtime";
import { Text } from 'ink';
const STATUS_COLORS = {
    'idle': 'gray',
    'working': 'green',
    'waiting-input': 'yellow',
    'waiting-approval': 'yellow',
    'stopped': 'red',
    'error': 'red',
};
const STATUS_LABELS = {
    'idle': 'IDLE',
    'working': 'WORKING',
    'waiting-input': 'WAITING-INPUT',
    'waiting-approval': 'WAITING-APPROVAL',
    'stopped': 'STOPPED',
    'error': 'ERROR',
};
export function StatusBadge({ status }) {
    const color = STATUS_COLORS[status] || 'gray';
    const label = STATUS_LABELS[status] || status.toUpperCase();
    return (_jsx(Text, { color: color, children: label }));
}
//# sourceMappingURL=StatusBadge.js.map