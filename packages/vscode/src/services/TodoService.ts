/**
 * TodoService - Re-exports core TodoService for VS Code
 *
 * This module provides access to the core TodoService through the ServiceContainer.
 * All TODO operations use the shared implementation from @opus-orchestra/core.
 *
 * The ServiceContainer creates TodoService with the correct path for WSL support
 * on Windows, using getHomeDir() from pathUtils.
 */

// Import type for use in return type annotation
import type { ITodoService } from '@opus-orchestra/core';

// Re-export types from core
export type { ITodoService, TodoItem, TodoState } from '@opus-orchestra/core';

/**
 * Get the TodoService instance from ServiceContainer.
 *
 * Note: ServiceContainer must be initialized before calling this function.
 * This is always true when called from AgentPanel during normal operation.
 */
export function getTodoService(): ITodoService {
    // Import dynamically to avoid circular dependencies
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isContainerInitialized, getContainer } = require('../ServiceContainer');

    if (!isContainerInitialized()) {
        throw new Error('ServiceContainer not initialized. TodoService requires container to be initialized first.');
    }

    return getContainer().todoService;
}

/**
 * Reset function for testing compatibility.
 * No-op since we now use ServiceContainer exclusively.
 */
export function resetTodoService(): void {
    // No-op - ServiceContainer manages the instance lifecycle
}
