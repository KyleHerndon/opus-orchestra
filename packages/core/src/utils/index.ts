/**
 * Core utilities
 */

export {
  getNextAvailableName,
  getAvailableNames,
  parseAgentName,
  getAgentNameDepth,
  compareAgentNames,
} from './agentNames';

// Timeout utilities
export {
  withTimeout,
  withSimpleTimeout,
  TimeoutError,
  CancelledError,
  delay,
  raceWithTimeout,
} from './timeout';
export type { TimeoutOptions, TimeoutResult } from './timeout';

// File watcher utilities
export {
  FileWatcher,
  createFileWatcher,
} from './FileWatcher';
export type {
  FileWatchEvent,
  FileWatcherOptions,
  FileWatchEventType,
  IFileWatcher,
} from './FileWatcher';

// Safe file system utilities
export {
  safeReadFile,
  safeReadDir,
  safeStat,
  safeFileExists,
  safeGetMtime,
  atomicWriteFile,
  atomicWriteFileWithBackup,
  safeReadJson,
  atomicWriteJson,
  safeReadJsonValidated,
} from './safeFs';

// Agent update utilities (immutable updates)
export {
  updateAgent,
  updateAgentStatus,
  updateAgentDiffStats,
  updateAgentTodos,
  updateAgentInMap,
  snapshotAgents,
  snapshotAgentsMap,
  diffStatsEqual,
  todosEqual,
} from './agentUpdates';
export type { AgentUpdate } from './agentUpdates';
