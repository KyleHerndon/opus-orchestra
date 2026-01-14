/**
 * Logger Service - VSCode singleton wrapper
 *
 * This module provides singleton accessor functions for the Logger.
 * Uses pino from @opus-orchestra/core.
 *
 * Usage:
 * - During early startup (before ServiceContainer): initLogger() creates a local instance
 * - After ServiceContainer init: getLogger() returns ServiceContainer's logger
 */

import { createLogger, LogLevel, ILogger } from '@opus-orchestra/core';

// Re-export types for convenience
export type { LogLevel };

/**
 * Global logger instance (used before ServiceContainer is available)
 */
let loggerInstance: ILogger | null = null;

/**
 * Initialize the global logger
 * Note: After ServiceContainer is initialized, this is no longer needed
 * but kept for backward compatibility during startup.
 */
export function initLogger(extensionPath: string, minLevel: LogLevel = 'debug'): ILogger {
    loggerInstance = createLogger(extensionPath, minLevel);
    return loggerInstance;
}

/**
 * Get the global logger instance.
 * Uses ServiceContainer's logger when available, falls back to local singleton.
 */
export function getLogger(): ILogger {
    // Try to use ServiceContainer's logger first (it's the canonical instance)
    try {
        // Dynamic import to avoid circular dependency
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { isContainerInitialized, getContainer } = require('../ServiceContainer');
        if (isContainerInitialized()) {
            return getContainer().logger as ILogger;
        }
    } catch {
        // ServiceContainer not available yet
    }

    // Fall back to local singleton
    if (!loggerInstance) {
        throw new Error('Logger not initialized. Call initLogger first.');
    }
    return loggerInstance;
}

/**
 * Check if logger is initialized
 */
export function isLoggerInitialized(): boolean {
    // Check ServiceContainer first
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { isContainerInitialized } = require('../ServiceContainer');
        if (isContainerInitialized()) {
            return true;
        }
    } catch {
        // ServiceContainer not available yet
    }
    return loggerInstance !== null;
}
