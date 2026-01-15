/**
 * EventBus - VSCode singleton wrapper
 *
 * This module provides singleton accessor functions for the EventBus.
 * The EventBus class itself is imported from @opus-orchestra/core.
 */

import { EventBus, IEventBus } from '@opus-orchestra/core';

/**
 * Singleton instance (fallback when ServiceContainer not available)
 */
let eventBusInstance: EventBus | null = null;

/**
 * Get the global EventBus instance.
 * Uses ServiceContainer's eventBus when available.
 */
export function getEventBus(): IEventBus {
    // Try to use ServiceContainer's eventBus first (it's the canonical instance)
    try {
        // Dynamic import to avoid circular dependency
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        const { isContainerInitialized, getContainer } = require('../ServiceContainer');
        if (isContainerInitialized()) {
            return getContainer().eventBus;
        }
    } catch {
        // ServiceContainer not available yet
    }

    // Fall back to local singleton
    if (!eventBusInstance) {
        eventBusInstance = new EventBus();
    }
    return eventBusInstance;
}

/**
 * Reset the global EventBus instance (for testing)
 */
export function resetEventBus(): void {
    eventBusInstance = null;
}
