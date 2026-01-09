/**
 * FileConfigAdapter - File-based configuration implementation
 *
 * Reads configuration from JSON files with the following priority:
 * 1. .opus-orchestra/config.json (project-local)
 * 2. ~/.config/opus-orchestra/config.json (user global)
 *
 * Supports file watching for live configuration updates.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DEFAULT_CONFIG } from '@opus-orchestra/core';
export class FileConfigAdapter {
    config;
    configPath = null;
    callbacks = new Set();
    watcher = null;
    /**
     * Create a new FileConfigAdapter.
     *
     * @param projectPath - Optional project directory for project-local config
     */
    constructor(projectPath) {
        this.config = { ...DEFAULT_CONFIG };
        this.configPath = this.findConfigPath(projectPath);
        if (this.configPath) {
            this.loadConfig();
            this.watchConfig();
        }
    }
    /**
     * Find the configuration file path.
     * Checks project-local first, then user global.
     */
    findConfigPath(projectPath) {
        // Check project-local config first
        if (projectPath) {
            const projectConfig = path.join(projectPath, '.opus-orchestra', 'config.json');
            if (fs.existsSync(projectConfig)) {
                return projectConfig;
            }
        }
        // Check user global config
        const userConfig = path.join(os.homedir(), '.config', 'opus-orchestra', 'config.json');
        if (fs.existsSync(userConfig)) {
            return userConfig;
        }
        // Return default location for creating new config
        if (projectPath) {
            return path.join(projectPath, '.opus-orchestra', 'config.json');
        }
        return path.join(os.homedir(), '.config', 'opus-orchestra', 'config.json');
    }
    /**
     * Load configuration from file.
     */
    loadConfig() {
        if (!this.configPath || !fs.existsSync(this.configPath)) {
            return;
        }
        try {
            const content = fs.readFileSync(this.configPath, 'utf-8');
            const fileConfig = JSON.parse(content);
            // Merge with defaults
            this.config = { ...DEFAULT_CONFIG, ...fileConfig };
        }
        catch (error) {
            console.error(`Failed to load config from ${this.configPath}:`, error);
        }
    }
    /**
     * Watch configuration file for changes.
     */
    watchConfig() {
        if (!this.configPath || !fs.existsSync(this.configPath)) {
            return;
        }
        try {
            this.watcher = fs.watch(this.configPath, (eventType) => {
                if (eventType === 'change') {
                    const oldConfig = { ...this.config };
                    this.loadConfig();
                    // Notify listeners of changed keys
                    for (const key of Object.keys(this.config)) {
                        if (oldConfig[key] !== this.config[key]) {
                            this.notifyChange(key);
                        }
                    }
                }
            });
        }
        catch (error) {
            console.error('Failed to watch config file:', error);
        }
    }
    /**
     * Notify all listeners of a configuration change.
     */
    notifyChange(key) {
        for (const callback of this.callbacks) {
            try {
                callback(key);
            }
            catch (error) {
                console.error('Config change callback error:', error);
            }
        }
    }
    /**
     * Save configuration to file.
     */
    saveConfig() {
        if (!this.configPath) {
            return;
        }
        try {
            // Ensure directory exists
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        }
        catch (error) {
            console.error(`Failed to save config to ${this.configPath}:`, error);
        }
    }
    get(key) {
        return this.config[key];
    }
    getAll() {
        return { ...this.config };
    }
    async update(key, value) {
        const oldValue = this.config[key];
        if (oldValue === value) {
            return;
        }
        this.config[key] = value;
        this.saveConfig();
        this.notifyChange(key);
    }
    onDidChange(callback) {
        this.callbacks.add(callback);
        return () => {
            this.callbacks.delete(callback);
        };
    }
    refresh() {
        this.loadConfig();
    }
    /**
     * Get the path to the config file.
     */
    get path() {
        return this.configPath;
    }
    /**
     * Stop watching the config file.
     */
    dispose() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
    }
}
//# sourceMappingURL=FileConfigAdapter.js.map