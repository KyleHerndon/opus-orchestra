/**
 * FileConfigAdapter - File-based configuration implementation
 *
 * Reads configuration from JSON files with the following priority:
 * 1. .opus-orchestra/config.json (project-local)
 * 2. ~/.config/opus-orchestra/config.json (user global)
 *
 * Uses Zod schema validation for robust config parsing.
 * Supports file watching for live configuration updates.
 */
import type { ConfigAdapter, ExtensionConfig, ConfigChangeCallback } from '@opus-orchestra/core';
export declare class FileConfigAdapter implements ConfigAdapter {
    private config;
    private configPath;
    private callbacks;
    private watcher;
    private configLoaded;
    private configError;
    /**
     * Create a new FileConfigAdapter.
     *
     * @param projectPath - Optional project directory for project-local config
     */
    constructor(projectPath?: string);
    /**
     * Check if config was loaded successfully.
     * Returns false if there was a parse error or the file doesn't exist.
     */
    isConfigLoaded(): boolean;
    /**
     * Get the error message if config loading failed.
     */
    getConfigError(): string | null;
    /**
     * Find the configuration file path.
     * Checks project-local first, then user global.
     */
    private findConfigPath;
    /**
     * Load configuration from file.
     * Uses Zod schema validation for robust parsing.
     * Sets configLoaded flag and configError on failure.
     */
    private loadConfig;
    /**
     * Watch configuration file for changes.
     * If watching fails, config changes won't be detected until restart.
     * Safe to call multiple times - closes existing watcher before creating new one.
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