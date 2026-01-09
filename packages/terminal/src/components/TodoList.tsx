/**
 * TodoList - Expandable todo items display
 *
 * Shows todos in tree-indented format with status icons.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { TodoItem } from '../types.js';

interface TodoListProps {
  todos: TodoItem[];
}

const STATUS_ICONS: Record<TodoItem['status'], string> = {
  pending: '○',
  in_progress: '▶',
  completed: '✓',
};

const STATUS_COLORS: Record<TodoItem['status'], string> = {
  pending: 'gray',
  in_progress: 'blue',
  completed: 'green',
};

export function TodoList({ todos }: TodoListProps): React.ReactElement {
  const completed = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        <Text dimColor>├─ Todos: </Text>
        <Text>{completed}/{total}</Text>
        <Text dimColor> ({percent}%)</Text>
      </Box>

      {/* Todo items */}
      {todos.map((todo, index) => {
        const isLast = index === todos.length - 1;
        const prefix = isLast ? '└─' : '├─';
        const icon = STATUS_ICONS[todo.status];
        const color = STATUS_COLORS[todo.status];
        const isCompleted = todo.status === 'completed';

        return (
          <Box key={index}>
            <Text dimColor>│  {prefix} </Text>
            <Text color={color}>{icon} </Text>
            <Text
              dimColor={isCompleted}
              strikethrough={isCompleted}
              bold={todo.status === 'in_progress'}
            >
              {todo.content}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
