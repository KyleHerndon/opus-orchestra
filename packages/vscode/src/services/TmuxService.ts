/**
 * TmuxService - Re-exports core TmuxService for VS Code
 *
 * This module provides access to the core TmuxService through the ServiceContainer.
 * All tmux operations use the shared implementation from @opus-orchestra/core.
 */

// Re-export the interface from core
export type { ITmuxService } from '@opus-orchestra/core';

/**
 * Get the TmuxService instance from ServiceContainer.
 *
 * Note: ServiceContainer must be initialized before calling this function.
 * This is always true when called from AgentManager methods during normal operation.
 */
export function getTmuxService() {
    // Import dynamically to avoid circular dependencies
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { isContainerInitialized, getContainer } = require('../ServiceContainer');

    if (!isContainerInitialized()) {
        throw new Error('ServiceContainer not initialized. TmuxService requires container to be initialized first.');
    }

    return getContainer().tmuxService;
}

/**
 * Reset function for testing compatibility.
 * No-op since we now use ServiceContainer exclusively.
 */
export function resetTmuxService(): void {
    // No-op - ServiceContainer manages the instance lifecycle
}
