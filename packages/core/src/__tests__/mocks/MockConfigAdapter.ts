/**
 * MockConfigAdapter - Mock implementation for testing
 */

import {
  ConfigAdapter,
  ExtensionConfig,
  DEFAULT_CONFIG,
  ConfigChangeCallback,
} from '../../adapters/ConfigAdapter';

/**
 * Mock ConfigAdapter for testing
 */
export class MockConfigAdapter implements ConfigAdapter {
  private config: ExtensionConfig;
  private callbacks: Set<ConfigChangeCallback> = new Set();

  constructor(overrides: Partial<ExtensionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...overrides };
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
    this.config[key] = value;
    for (const callback of this.callbacks) {
      callback(key);
    }
  }

  onDidChange(callback: ConfigChangeCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  refresh(): void {
    // No-op for mock
  }

  /**
   * Set multiple config values at once (for test setup)
   */
  setConfig(overrides: Partial<ExtensionConfig>): void {
    this.config = { ...this.config, ...overrides };
  }
}
