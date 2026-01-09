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
import type {
  ConfigAdapter,
  ExtensionConfig,
  ConfigChangeCallback,
} from '@opus-orchestra/core';
import { DEFAULT_CONFIG } from '@opus-orchestra/core';

export class FileConfigAdapter implements ConfigAdapter {
  private config: ExtensionConfig;
  private configPath: string | null = null;
  private callbacks: Set<ConfigChangeCallback> = new Set();
  private watcher: fs.FSWatcher | null = null;

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
   */
  private loadConfig(): void {
    if (!this.configPath || !fs.existsSync(this.configPath)) {
      return;
    }

    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      const fileConfig = JSON.parse(content) as Partial<ExtensionConfig>;

      // Merge with defaults
      this.config = { ...DEFAULT_CONFIG, ...fileConfig };
    } catch (error) {
      console.error(`Failed to load config from ${this.configPath}:`, error);
    }
  }

  /**
   * Watch configuration file for changes.
   */
  private watchConfig(): void {
    if (!this.configPath || !fs.existsSync(this.configPath)) {
      return;
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
    } catch (error) {
      console.error('Failed to watch config file:', error);
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
        console.error('Config change callback error:', error);
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
      console.error(`Failed to save config to ${this.configPath}:`, error);
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
