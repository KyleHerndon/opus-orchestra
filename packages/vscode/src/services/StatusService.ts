/**
 * StatusService - VSCode singleton wrapper
 *
 * This module provides singleton accessor functions for the StatusService.
 * The StatusService class itself is imported from @opus-orchestra/core.
 *
 * Note: ServiceContainer creates the StatusService with SystemAdapter, which
 * handles WSL path conversions via NodeSystemAdapter.
 */

import { StatusService, IStatusService, NodeSystemAdapter } from '@opus-orchestra/core';

/**
 * Singleton instance (fallback when ServiceContainer not available)
 */
let statusServiceInstance: StatusService | null = null;

/**
 * Get the global StatusService instance.
 * Uses ServiceContainer's statusService when available.
 */
export function getStatusService(): IStatusService {
    // Try to use ServiceContainer's statusService first (it's the canonical instance)
    try {
        // Dynamic import to avoid circular dependency
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { isContainerInitialized, getContainer } = require('../ServiceContainer');
        if (isContainerInitialized()) {
            return getContainer().statusService;
        }
    } catch {
        // ServiceContainer not available yet
    }

    // Fall back to local singleton with default SystemAdapter
    // Use 'wsl' as default since this extension typically runs on Windows with WSL
    if (!statusServiceInstance) {
        const system = new NodeSystemAdapter('wsl');
        statusServiceInstance = new StatusService(system);
    }
    return statusServiceInstance;
}

/**
 * Reset the global StatusService instance (for testing)
 */
export function resetStatusService(): void {
    statusServiceInstance = null;
}
