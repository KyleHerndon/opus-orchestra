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

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type {
  ConfigAdapter,
  ExtensionConfig,
  ConfigChangeCallback,
} from '@opus-orchestra/core';
import {
  DEFAULT_CONFIG,
  ExtensionConfigSchema,
  formatZodError,
} from '@opus-orchestra/core';

export class FileConfigAdapter implements ConfigAdapter {
  private config: ExtensionConfig;
  private configPath: string | null = null;
  private callbacks: Set<ConfigChangeCallback> = new Set();
  private watcher: fs.FSWatcher | null = null;
  private configLoaded: boolean = false;
  private configError: string | null = null;

  /**
   * Create a new FileConfigAdapter.
   *
   * @param projectPath - Optional project directory for project-local config
   */
  constructor(projectPath?: string) {
    this.config = { ...DEFAULT_CONFIG };
    this.configPath = this.findConfigPath(projectPath);

    if (this.configPath) {
      this.loadConfig();
      this.watchConfig();
    }
  }

  /**
   * Check if config was loaded successfully.
   * Returns false if there was a parse error or the file doesn't exist.
   */
  isConfigLoaded(): boolean {
    return this.configLoaded;
  }

  /**
   * Get the error message if config loading failed.
   */
  getConfigError(): string | null {
    return this.configError;
  }

  /**
   * Find the configuration file path.
   * Checks project-local first, then user global.
   */
  private findConfigPath(projectPath?: string): string | null {
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
   * Uses Zod schema validation for robust parsing.
   * Sets configLoaded flag and configError on failure.
   */
  private loadConfig(): void {
    if (!this.configPath) {
      this.configError = 'No config path specified';
      return;
    }

    if (!fs.existsSync(this.configPath)) {
      // No config file - use defaults (this is normal, not an error)
      this.configLoaded = false;
      this.configError = null;
      return;
    }

    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      const rawConfig = JSON.parse(content);

      // Validate with Zod schema - this will apply defaults and type coercion
      const parseResult = ExtensionConfigSchema.safeParse({
        ...DEFAULT_CONFIG,
        ...rawConfig,
      });

      if (parseResult.success) {
        this.config = parseResult.data as ExtensionConfig;
        this.configLoaded = true;
        this.configError = null;
      } else {
        // Schema validation failed - log specific errors
        const validationErrors = formatZodError(parseResult.error);
        this.configError = `Invalid config at ${this.configPath}: ${validationErrors}`;
        console.error(`[opus-orchestra] ${this.configError}`);
        console.error('[opus-orchestra] Using default configuration. Fix the config file or delete it to use defaults.');
        this.configLoaded = false;
      }
    } catch (error) {
      // JSON parse error or file read error
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.configError = `Failed to parse config at ${this.configPath}: ${errorMessage}`;
      console.error(`[opus-orchestra] ${this.configError}`);
      console.error('[opus-orchestra] Using default configuration. Fix the config file or delete it to use defaults.');

      // Keep using defaults
      this.configLoaded = false;
    }
  }

  /**
   * Watch configuration file for changes.
   * If watching fails, config changes won't be detected until restart.
   * Safe to call multiple times - closes existing watcher before creating new one.
   */
  private watchConfig(): void {
    if (!this.configPath || !fs.existsSync(this.configPath)) {
      return;
    }

    // Close existing watcher if any (prevents resource leak on multiple calls)
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    try {
      this.watcher = fs.watch(this.configPath, (eventType) => {
        if (eventType === 'change') {
          const oldConfig = { ...this.config };
          this.loadConfig();

          // Notify listeners of changed keys
          for (const key of Object.keys(this.config) as (keyof ExtensionConfig)[]) {
            if (oldConfig[key] !== this.config[key]) {
              this.notifyChange(key);
            }
          }
        }
      });

      // Handle watcher errors to prevent unhandled exceptions
      this.watcher.on('error', (err) => {
        console.error(`[opus-orchestra] Config file watcher error: ${err.message}`);
      });
    } catch (error) {
      // Note: We use console.error here because this runs before the logger is initialized
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[opus-orchestra] Failed to watch config file at ${this.configPath}: ${errorMessage}`);
      console.error('[opus-orchestra] Config changes will not be detected until restart.');
    }
  }

  /**
   * Notify all listeners of a configuration change.
   */
  private notifyChange(key: keyof ExtensionConfig): void {
    for (const callback of this.callbacks) {
      try {
        callback(key);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[opus-orchestra] Config change callback error for '${key}': ${errorMessage}`);
      }
    }
  }

  /**
   * Save configuration to file.
   */
  private saveConfig(): void {
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[opus-orchestra] Failed to save config to ${this.configPath}: ${errorMessage}`);
      console.error('[opus-orchestra] Configuration changes may not persist.');
    }
  }

  get<K extends keyof ExtensionConfig>(key: K): ExtensionConfig[K] {
    return this.config[key];
  }

  getAll(): ExtensionConfig {
    return { ...this.config };
  }

  async update<K extends keyof ExtensionConfig>(
    key: K,
    value: ExtensionConfig[K]
  ): Promise<void> {
    const oldValue = this.config[key];
    if (oldValue === value) {
      return;
    }

    this.config[key] = value;
    this.saveConfig();
    this.notifyChange(key);
  }

  onDidChange(callback: ConfigChangeCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  refresh(): void {
    this.loadConfig();
  }

  /**
   * Get the path to the config file.
   */
  get path(): string | null {
    return this.configPath;
  }

  /**
   * Stop watching the config file.
   */
  dispose(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
