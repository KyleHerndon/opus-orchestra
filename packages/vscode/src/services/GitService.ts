/**
 * GitService - VSCode singleton wrapper
 *
 * This module provides singleton accessor functions for the GitService.
 * The GitService class itself is imported from @opus-orchestra/core.
 *
 * Note: ServiceContainer creates the GitService with SystemAdapter.
 * The fallback (when ServiceContainer is unavailable) creates a new instance
 * with a NodeSystemAdapter.
 */

import { GitService, IGitService, NodeSystemAdapter } from '@opus-orchestra/core';
import { getConfigService } from './ConfigService';

/**
 * Singleton instance (fallback when ServiceContainer not available)
 */
let gitServiceInstance: GitService | null = null;

/**
 * Get the global GitService instance.
 * Uses ServiceContainer's gitService when available.
 */
export function getGitService(): IGitService {
    // Try to use ServiceContainer's gitService first (it's the canonical instance)
    try {
        // Dynamic import to avoid circular dependency
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        const { isContainerInitialized, getContainer } = require('../ServiceContainer');
        if (isContainerInitialized()) {
            return getContainer().gitService;
        }
    } catch {
        // ServiceContainer not available yet
    }

    // Fall back to local singleton with NodeSystemAdapter
    if (!gitServiceInstance) {
        const terminalType = getConfigService().terminalType ?? 'bash';
        const system = new NodeSystemAdapter(terminalType as 'bash' | 'wsl' | 'powershell' | 'cmd' | 'gitbash');
        gitServiceInstance = new GitService(system);
    }
    return gitServiceInstance;
}

/**
 * Reset the global GitService instance (for testing)
 */
export function resetGitService(): void {
    gitServiceInstance = null;
}
