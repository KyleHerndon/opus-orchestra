/**
 * ConfigService - Type-safe configuration access
 *
 * Provides centralized, type-safe access to VS Code configuration
 * with proper defaults and validation.
 */

import * as vscode from 'vscode';
import {
    ExtensionConfig,
    DEFAULT_CONFIG,
    CONFIG_SECTION,
    IsolationTier,
    TerminalType,
} from '../types';

/**
 * Type-safe configuration service
 */
export class ConfigService {
    private config: vscode.WorkspaceConfiguration;

    constructor() {
        this.config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    }

    /**
     * Refresh the configuration (call after settings change)
     */
    refresh(): void {
        this.config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    }

    // ========================================================================
    // Agent Settings
    // ========================================================================

    get defaultAgentCount(): number {
        return this.config.get<number>('defaultAgentCount', DEFAULT_CONFIG.defaultAgentCount);
    }

    get autoStartClaude(): boolean {
        return this.config.get<boolean>('autoStartClaude', DEFAULT_CONFIG.autoStartClaude);
    }

    get claudeCommand(): string {
        return this.config.get<string>('claudeCommand', DEFAULT_CONFIG.claudeCommand);
    }

    // ========================================================================
    // Directory Settings
    // ========================================================================

    get worktreeDirectory(): string {
        return this.config.get<string>('worktreeDirectory', DEFAULT_CONFIG.worktreeDirectory);
    }

    get coordinationScriptsPath(): string {
        return this.config.get<string>('coordinationScriptsPath', DEFAULT_CONFIG.coordinationScriptsPath);
    }

    get backlogPath(): string {
        return this.config.get<string>('backlogPath', DEFAULT_CONFIG.backlogPath);
    }

    get repositoryPaths(): string[] {
        return this.config.get<string[]>('repositoryPaths', DEFAULT_CONFIG.repositoryPaths);
    }

    // ========================================================================
    // Terminal Settings
    // ========================================================================

    get terminalType(): TerminalType {
        return this.config.get<TerminalType>('terminalType', DEFAULT_CONFIG.terminalType);
    }

    // ========================================================================
    // Polling Intervals
    // ========================================================================

    get statusPollingInterval(): number {
        return this.config.get<number>('statusPollingInterval', DEFAULT_CONFIG.statusPollingInterval);
    }

    get diffPollingInterval(): number {
        return this.config.get<number>('diffPollingInterval', DEFAULT_CONFIG.diffPollingInterval);
    }

    // ========================================================================
    // Isolation Settings
    // ========================================================================

    get isolationTier(): IsolationTier {
        return this.config.get<IsolationTier>('isolationTier', DEFAULT_CONFIG.isolationTier);
    }

    get containerImage(): string {
        return this.config.get<string>('containerImage', DEFAULT_CONFIG.containerImage);
    }

    get containerMemoryLimit(): string {
        return this.config.get<string>('containerMemoryLimit', DEFAULT_CONFIG.containerMemoryLimit);
    }

    get containerCpuLimit(): string {
        return this.config.get<string>('containerCpuLimit', DEFAULT_CONFIG.containerCpuLimit);
    }

    get firecrackerPath(): string {
        return this.config.get<string>('firecrackerPath', DEFAULT_CONFIG.firecrackerPath);
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    /**
     * Get all configuration as a single object
     */
    getAll(): ExtensionConfig {
        return {
            defaultAgentCount: this.defaultAgentCount,
            autoStartClaude: this.autoStartClaude,
            claudeCommand: this.claudeCommand,
            worktreeDirectory: this.worktreeDirectory,
            coordinationScriptsPath: this.coordinationScriptsPath,
            backlogPath: this.backlogPath,
            repositoryPaths: this.repositoryPaths,
            terminalType: this.terminalType,
            statusPollingInterval: this.statusPollingInterval,
            diffPollingInterval: this.diffPollingInterval,
            isolationTier: this.isolationTier,
            containerImage: this.containerImage,
            containerMemoryLimit: this.containerMemoryLimit,
            containerCpuLimit: this.containerCpuLimit,
            firecrackerPath: this.firecrackerPath,
        };
    }

    /**
     * Update a configuration value
     */
    async update<K extends keyof ExtensionConfig>(
        key: K,
        value: ExtensionConfig[K],
        target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
    ): Promise<void> {
        await this.config.update(key, value, target);
        this.refresh();
    }

    /**
     * Check if a configuration key has been explicitly set
     */
    hasValue(key: keyof ExtensionConfig): boolean {
        const inspection = this.config.inspect(key);
        return inspection !== undefined && (
            inspection.globalValue !== undefined ||
            inspection.workspaceValue !== undefined ||
            inspection.workspaceFolderValue !== undefined
        );
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
