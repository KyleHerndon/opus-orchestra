/**
 * FileConfigAdapter - File-based configuration implementation
 *
 * Reads configuration from JSON files with the following priority:
 * 1. .opus-orchestra/config.json (project-local)
 * 2. ~/.config/opus-orchestra/config.json (user global)
 *
 * Supports file watching for live configuration updates.
 */
import type { ConfigAdapter, ExtensionConfig, ConfigChangeCallback } from '@opus-orchestra/core';
export declare class FileConfigAdapter implements ConfigAdapter {
    private config;
    private configPath;
    private callbacks;
    private watcher;
    /**
     * Create a new FileConfigAdapter.
     *
     * @param projectPath - Optional project directory for project-local config
     */
    constructor(projectPath?: string);
    /**
     * Find the configuration file path.
     * Checks project-local first, then user global.
     */
    private findConfigPath;
    /**
     * Load configuration from file.
     */
    private loadConfig;
    /**
     * Watch configuration file for changes.
     */
    private watchConfig;
    /**
     * Notify all listeners of a configuration change.
     */
    private notifyChange;
    /**
     * Save configuration to file.
     */
    private saveConfig;
    get<K extends keyof ExtensionConfig>(key: K): ExtensionConfig[K];
    getAll(): ExtensionConfig;
    update<K extends keyof ExtensionConfig>(key: K, value: ExtensionConfig[K]): Promise<void>;
    onDidChange(callback: ConfigChangeCallback): () => void;
    refresh(): void;
    /**
     * Get the path to the config file.
     */
    get path(): string | null;
    /**
     * Stop watching the config file.
     */
    dispose(): void;
}
//# sourceMappingURL=FileConfigAdapter.d.ts.map