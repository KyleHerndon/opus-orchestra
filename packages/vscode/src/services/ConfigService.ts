/**
 * ConfigService - Type-safe configuration access
 *
 * Provides convenience getters for VS Code configuration.
 * Delegates to ServiceContainer's VSCodeConfigAdapter when available.
 *
 * This is a facade that adds ergonomic property access on top of
 * the core ConfigAdapter interface.
 */

import {
    ExtensionConfig,
    TerminalType,
    ConfigAdapter,
} from '@opus-orchestra/core';
import { LogLevel } from './Logger';
import { VSCodeConfigAdapter } from '../adapters';

// Re-export LogLevel for convenience
export { LogLevel };

/**
 * Type-safe configuration service with convenience getters.
 * Delegates to ConfigAdapter for actual config access.
 */
export class ConfigService {
    private _adapter: ConfigAdapter | null = null;

    /**
     * Get the underlying config adapter.
     * Uses ServiceContainer when available, falls back to local adapter.
     */
    private get adapter(): ConfigAdapter {
        if (this._adapter) {
            return this._adapter;
        }

        // Try to use ServiceContainer's adapter
        try {
            // Dynamic import to avoid circular dependency
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { isContainerInitialized, getContainer } = require('../ServiceContainer');
            if (isContainerInitialized()) {
                const containerConfig = getContainer().config as ConfigAdapter;
                this._adapter = containerConfig;
                return containerConfig;
            }
        } catch {
            // ServiceContainer not available yet
        }

        // Fall back to creating a local adapter
        const localAdapter = new VSCodeConfigAdapter();
        this._adapter = localAdapter;
        return localAdapter;
    }

    /**
     * Refresh the configuration (call after settings change)
     */
    refresh(): void {
        this.adapter.refresh();
    }

    // ========================================================================
    // Agent Settings
    // ========================================================================

    get defaultAgentCount(): number {
        return this.adapter.get('defaultAgentCount');
    }

    get autoStartClaude(): boolean {
        return this.adapter.get('autoStartClaude');
    }

    get autoStartClaudeOnFocus(): boolean {
        return this.adapter.get('autoStartClaudeOnFocus');
    }

    get claudeCommand(): string {
        return this.adapter.get('claudeCommand');
    }

    // ========================================================================
    // Tmux Settings
    // ========================================================================

    get useTmux(): boolean {
        return this.adapter.get('useTmux');
    }

    get tmuxSessionPrefix(): string {
        return this.adapter.get('tmuxSessionPrefix');
    }

    // ========================================================================
    // Directory Settings
    // ========================================================================

    get worktreeDirectory(): string {
        return this.adapter.get('worktreeDirectory');
    }

    get coordinationScriptsPath(): string {
        return this.adapter.get('coordinationScriptsPath');
    }

    get backlogPath(): string {
        return this.adapter.get('backlogPath');
    }

    get repositoryPaths(): string[] {
        return this.adapter.get('repositoryPaths');
    }

    // ========================================================================
    // Terminal Settings
    // ========================================================================

    get terminalType(): TerminalType {
        return this.adapter.get('terminalType');
    }

    // ========================================================================
    // Logging Settings
    // ========================================================================

    get logLevel(): LogLevel {
        return this.adapter.get('logLevel');
    }

    // ========================================================================
    // Polling Intervals
    // ========================================================================

    get diffPollingInterval(): number {
        return this.adapter.get('diffPollingInterval');
    }

    // ========================================================================
    // Container Settings (legacy - kept for backward compatibility)
    // ========================================================================

    get containerImage(): string {
        return this.adapter.get('containerImage');
    }

    get containerMemoryLimit(): string {
        return this.adapter.get('containerMemoryLimit');
    }

    get containerCpuLimit(): string {
        return this.adapter.get('containerCpuLimit');
    }

    get cloudHypervisorPath(): string {
        return this.adapter.get('cloudHypervisorPath');
    }

    get containerPidsLimit(): number {
        return this.adapter.get('containerPidsLimit');
    }

    get gvisorEnabled(): boolean {
        return this.adapter.get('gvisorEnabled');
    }

    // ========================================================================
    // Isolation Settings
    // ========================================================================

    get isolationTier(): string {
        return this.adapter.get('isolationTier');
    }

    get allowedDomains(): string[] {
        return this.adapter.get('allowedDomains');
    }

    get proxyPort(): number {
        return this.adapter.get('proxyPort');
    }

    // ========================================================================
    // Permission Settings
    // ========================================================================

    get showAllPermissionOptions(): boolean {
        return this.adapter.get('showAllPermissionOptions');
    }

    // ========================================================================
    // UI Settings
    // ========================================================================

    get uiScale(): number {
        return this.adapter.get('uiScale');
    }

    // ========================================================================
    // API Settings
    // ========================================================================

    get autoSwitchToApiOnRateLimit(): boolean {
        return this.adapter.get('autoSwitchToApiOnRateLimit');
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    /**
     * Get all configuration as a single object
     */
    getAll(): ExtensionConfig {
        return this.adapter.getAll();
    }

    /**
     * Update a configuration value
     */
    async update<K extends keyof ExtensionConfig>(
        key: K,
        value: ExtensionConfig[K]
    ): Promise<void> {
        await this.adapter.update(key, value);
    }
}

/**
 * Singleton instance for global access
 */
let configServiceInstance: ConfigService | null = null;

/**
 * Get the global ConfigService instance
 */
export function getConfigService(): ConfigService {
    if (!configServiceInstance) {
        configServiceInstance = new ConfigService();
    }
    return configServiceInstance;
}

/**
 * Reset the global ConfigService instance (for testing)
 */
export function resetConfigService(): void {
    configServiceInstance = null;
}
