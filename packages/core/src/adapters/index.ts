/**
 * Adapter interfaces
 *
 * These interfaces abstract platform-specific operations, allowing
 * core logic to be tested and run in different environments.
 */

// System operations (OS, paths, commands, filesystem)
export {
  SystemAdapter,
  Platform,
  TerminalType,
  PathContext,
  FileStat,
  SpawnedProcess,
} from './SystemAdapter';

// Node.js implementation of SystemAdapter
export { NodeSystemAdapter } from './NodeSystemAdapter';

// Terminal management
export {
  TerminalAdapter,
  TerminalHandle,
  CreateTerminalOptions,
  TerminalCloseCallback,
} from './TerminalAdapter';

// Persistent storage
export {
  StorageAdapter,
} from './StorageAdapter';

// Configuration
export {
  ConfigAdapter,
  ExtensionConfig,
  DEFAULT_CONFIG,
  POLLING_DEFAULTS,
  ConfigChangeCallback,
} from './ConfigAdapter';

// User interface
export {
  UIAdapter,
  QuickPickItem,
  InputOptions,
  QuickPickOptions,
  ProgressOptions,
  ProgressReporter,
  CancellationToken,
} from './UIAdapter';
