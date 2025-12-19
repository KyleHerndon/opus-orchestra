/**
 * VSCodeConfigAdapter - VS Code configuration adapter
 *
 * Implements ConfigAdapter using VS Code's workspace configuration API.
 */

import * as vscode from 'vscode';
import {
  ConfigAdapter,
  ExtensionConfig,
  DEFAULT_CONFIG,
  ConfigChangeCallback,
} from '@opus-orchestra/core';

/**
 * Configuration section name in VS Code settings.
 */
const CONFIG_SECTION = 'claudeAgents';

/**
 * VS Code configuration adapter.
 * Uses vscode.workspace.getConfiguration for settings access.
 */
export class VSCodeConfigAdapter implements ConfigAdapter {
  private config: vscode.WorkspaceConfiguration;
  private changeCallbacks: Set<ConfigChangeCallback> = new Set();
  private disposable: vscode.Disposable | null = null;

  constructor() {
    this.config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    this.setupChangeListener();
  }

  private setupChangeListener(): void {
    this.disposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_SECTION)) {
        this.refresh();
        // Determine which keys changed and notify
        for (const key of Object.keys(DEFAULT_CONFIG) as (keyof ExtensionConfig)[]) {
          if (e.affectsConfiguration(`${CONFIG_SECTION}.${key}`)) {
            for (const callback of this.changeCallbacks) {
              callback(key);
            }
          }
        }
      }
    });
  }

  get<K extends keyof ExtensionConfig>(key: K): ExtensionConfig[K] {
    return this.config.get<ExtensionConfig[K]>(key, DEFAULT_CONFIG[key]);
  }

  getAll(): ExtensionConfig {
    const result: Partial<ExtensionConfig> = {};
    for (const key of Object.keys(DEFAULT_CONFIG) as (keyof ExtensionConfig)[]) {
      (result as Record<string, unknown>)[key] = this.get(key);
    }
    return result as ExtensionConfig;
  }

  async update<K extends keyof ExtensionConfig>(
    key: K,
    value: ExtensionConfig[K]
  ): Promise<void> {
    await this.config.update(key, value, vscode.ConfigurationTarget.Global);
    this.refresh();
  }

  onDidChange(callback: ConfigChangeCallback): () => void {
    this.changeCallbacks.add(callback);
    return () => {
      this.changeCallbacks.delete(callback);
    };
  }

  refresh(): void {
    this.config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  }

  /**
   * Dispose resources (call when extension deactivates).
   */
  dispose(): void {
    this.disposable?.dispose();
    this.disposable = null;
    this.changeCallbacks.clear();
  }
}
