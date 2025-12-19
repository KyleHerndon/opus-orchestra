/**
 * ConfigAdapter - Abstracts configuration access
 *
 * This interface allows core logic to access configuration without
 * depending on VS Code's configuration API.
 *
 * Implementations:
 * - VSCodeConfigAdapter (packages/vscode) - VS Code settings
 * - FileConfigAdapter - File-based config for CLI/web
 * - MockConfigAdapter (tests) - In-memory config for testing
 */

import { TerminalType } from './SystemAdapter';

/**
 * Extension configuration schema
 */
export interface ExtensionConfig {
  // Agent settings
  defaultAgentCount: number;
  autoStartClaude: boolean;
  autoStartClaudeOnFocus: boolean;
  claudeCommand: string;

  // Tmux settings
  useTmux: boolean;
  tmuxSessionPrefix: string;

  // Directory settings
  worktreeDirectory: string;
  coordinationScriptsPath: string;
  backlogPath: string;
  repositoryPaths: string[];

  // Terminal settings
  terminalType: TerminalType;

  // Polling intervals (ms)
  diffPollingInterval: number;

  // Container settings
  containerImage: string;
  containerMemoryLimit: string;
  containerCpuLimit: string;
  containerPidsLimit: number;
  gvisorEnabled: boolean;
  cloudHypervisorPath: string;

  // Isolation settings
  isolationTier: string;
  allowedDomains: string[];
  proxyPort: number;

  // Permission settings
  showAllPermissionOptions: boolean;

  // UI settings
  uiScale: number;

  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  // API settings
  autoSwitchToApiOnRateLimit: boolean;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: ExtensionConfig = {
  defaultAgentCount: 3,
  autoStartClaude: false,
  autoStartClaudeOnFocus: true,
  claudeCommand: 'claude',
  useTmux: true,
  tmuxSessionPrefix: 'opus',
  worktreeDirectory: '.worktrees',
  coordinationScriptsPath: '',
  backlogPath: '',
  repositoryPaths: [],
  terminalType: 'bash',
  diffPollingInterval: 60000,
  containerImage: 'ghcr.io/kyleherndon/opus-orchestra-sandbox:latest',
  containerMemoryLimit: '4g',
  containerCpuLimit: '2',
  containerPidsLimit: 100,
  gvisorEnabled: false,
  cloudHypervisorPath: '',
  isolationTier: 'standard',
  allowedDomains: ['api.anthropic.com', 'registry.npmjs.org', 'pypi.org'],
  proxyPort: 8377,
  showAllPermissionOptions: false,
  uiScale: 1,
  logLevel: 'debug',
  autoSwitchToApiOnRateLimit: false,
};

/**
 * Polling interval defaults (in ms)
 */
export const POLLING_DEFAULTS = {
  status: 1000,
  diff: 60000,
} as const;

/**
 * Configuration change callback
 */
export type ConfigChangeCallback = (key: keyof ExtensionConfig) => void;

/**
 * ConfigAdapter abstracts configuration access.
 */
export interface ConfigAdapter {
  /**
   * Get a configuration value.
   *
   * @param key - Configuration key
   * @returns Configuration value
   */
  get<K extends keyof ExtensionConfig>(key: K): ExtensionConfig[K];

  /**
   * Get all configuration values.
   *
   * @returns Complete configuration object
   */
  getAll(): ExtensionConfig;

  /**
   * Update a configuration value.
   *
   * @param key - Configuration key
   * @param value - New value
   * @returns Promise that resolves when update is complete
   */
  update<K extends keyof ExtensionConfig>(
    key: K,
    value: ExtensionConfig[K]
  ): Promise<void>;

  /**
   * Subscribe to configuration changes.
   *
   * @param callback - Function to call when configuration changes
   * @returns Unsubscribe function
   */
  onDidChange(callback: ConfigChangeCallback): () => void;

  /**
   * Refresh configuration from source.
   * Call this to pick up external changes.
   */
  refresh(): void;
}
