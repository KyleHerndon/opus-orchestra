import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
const STATUS_ICONS = {
    pending: '○',
    in_progress: '▶',
    completed: '✓',
};
const STATUS_COLORS = {
    pending: 'gray',
    in_progress: 'blue',
    completed: 'green',
};
export function TodoList({ todos }) {
    const completed = todos.filter((t) => t.status === 'completed').length;
    const total = todos.length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "\u251C\u2500 Todos: " }), _jsxs(Text, { children: [completed, "/", total] }), _jsxs(Text, { dimColor: true, children: [" (", percent, "%)"] })] }), todos.map((todo, index) => {
                const isLast = index === todos.length - 1;
                const prefix = isLast ? '└─' : '├─';
                const icon = STATUS_ICONS[todo.status];
                const color = STATUS_COLORS[todo.status];
                const isCompleted = todo.status === 'completed';
                return (_jsxs(Box, { children: [_jsxs(Text, { dimColor: true, children: ["\u2502  ", prefix, " "] }), _jsxs(Text, { color: color, children: [icon, " "] }), _jsx(Text, { dimColor: isCompleted, strikethrough: isCompleted, bold: todo.status === 'in_progress', children: todo.content })] }, index));
            })] }));
}
//# sourceMappingURL=TodoList.js.map