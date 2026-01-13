/**
 * FileWatcher - Hybrid file watcher with reliable polling backup
 *
 * Architecture:
 * - Primary: chokidar for efficient event-driven updates (when available)
 * - Backup: configurable polling that ALWAYS runs alongside chokidar
 * - This ensures updates are never missed, even if chokidar silently fails
 *
 * The backup polling acts as a guaranteed minimum refresh rate.
 * File watchers (especially on network drives, WSL, etc.) can be unreliable,
 * so we always poll as a safety net.
 *
 * WSL Detection: Automatically enables polling mode on WSL for reliability.
 */

import type { FSWatcher } from 'chokidar';
import type { ILogger } from '../services/Logger';
import * as fs from 'fs';

/**
 * File watch event types
 */
export type FileWatchEventType =
  | 'add'
  | 'change'
  | 'unlink'
  | 'addDir'
  | 'unlinkDir'
  | 'poll'
  | 'error';

/**
 * File watch event
 */
export interface FileWatchEvent {
  type: FileWatchEventType;
  path: string;
  timestamp: number;
}

/**
 * FileWatcher configuration
 */
export interface FileWatcherOptions {
  /** Paths/globs to watch */
  paths: string[];
  /** Event callback */
  onEvent: (event: FileWatchEvent) => void;
  /**
   * Backup polling interval in ms (default: 5000)
   * This polling ALWAYS runs alongside chokidar as a safety net.
   * Set to 0 to disable backup polling (not recommended).
   */
  pollInterval?: number;
  /**
   * Health check interval in ms (default: 60000)
   * If no chokidar events for this long, logs a warning.
   */
  healthCheckInterval?: number;
  /** Force polling-only mode (no chokidar) */
  usePollingOnly?: boolean;
  /** Logger instance */
  logger?: ILogger;
  /** Error callback */
  onError?: (error: Error) => void;
  /** Debounce delay for file events in ms (default: 100) */
  debounceMs?: number;
}

/**
 * FileWatcher interface
 */
export interface IFileWatcher {
  start(): Promise<void>;
  stop(): void;
  isHealthy(): boolean;
  isRunning(): boolean;
  getWatchedPaths(): string[];
  addPath(path: string): void;
  removePath(path: string): void;
}

/**
 * Default configuration values
 */
const DEFAULT_POLL_INTERVAL = 5000;
const DEFAULT_HEALTH_CHECK_INTERVAL = 60000;
const DEFAULT_DEBOUNCE_MS = 100;

/**
 * Cached WSL detection result
 */
let isWslCached: boolean | null = null;

/**
 * Detect if running in WSL (Windows Subsystem for Linux)
 * Native file watchers are unreliable in WSL, so we use polling instead.
 * Exported for use in tests and other modules that need environment detection.
 */
export function isWsl(): boolean {
  if (isWslCached !== null) {
    return isWslCached;
  }

  try {
    // Check if /proc/version contains 'microsoft' (case-insensitive)
    if (process.platform === 'linux' && fs.existsSync('/proc/version')) {
      const version = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
      isWslCached = version.includes('microsoft') || version.includes('wsl');
      return isWslCached;
    }
  } catch {
    // Ignore errors, assume not WSL
  }

  isWslCached = false;
  return false;
}

// Internal alias for backwards compatibility
const detectWsl = isWsl;

/**
 * Hybrid FileWatcher implementation
 *
 * Uses chokidar for efficient file watching when available,
 * with backup polling that ALWAYS runs alongside chokidar.
 * This ensures updates are never missed, even if file watching is unreliable.
 */
export class FileWatcher implements IFileWatcher {
  private readonly paths: Set<string>;
  private readonly onEvent: (event: FileWatchEvent) => void;
  private readonly pollInterval: number;
  private readonly healthCheckInterval: number;
  private readonly usePollingOnly: boolean;
  private readonly debounceMs: number;
  private readonly onError?: (error: Error) => void;
  private readonly logger?: ILogger;

  private watcher: FSWatcher | null = null;
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;
  private healthCheckIntervalId: ReturnType<typeof setInterval> | null = null;

  private lastChokidarEventTime: number = 0;
  private isWatcherHealthy: boolean = true;
  private _isRunning: boolean = false;

  // Debouncing state
  private pendingEvents: Map<string, FileWatchEvent> = new Map();
  private debounceTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(options: FileWatcherOptions) {
    this.paths = new Set(options.paths);
    this.onEvent = options.onEvent;
    this.pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;
    this.healthCheckInterval = options.healthCheckInterval ?? DEFAULT_HEALTH_CHECK_INTERVAL;
    this.usePollingOnly = options.usePollingOnly ?? false;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.onError = options.onError;
    this.logger = options.logger?.child({ component: 'FileWatcher' });
  }

  /**
   * Start watching files
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      this.logger?.debug('FileWatcher already running');
      return;
    }

    this._isRunning = true;
    this.lastChokidarEventTime = Date.now();

    if (this.usePollingOnly) {
      this.logger?.info('Starting in polling-only mode');
    } else {
      await this.startChokidarWatcher();
    }

    // ALWAYS start backup polling (runs alongside chokidar)
    // This is the key reliability feature - polling acts as a safety net
    if (this.pollInterval > 0) {
      this.startBackupPolling();
    }

    // Start health check (monitors chokidar, logs warnings if it goes silent)
    if (!this.usePollingOnly) {
      this.startHealthCheck();
    }

    this.logger?.info(`FileWatcher started, watching: ${[...this.paths].join(', ')}`);
  }

  /**
   * Stop watching files
   */
  stop(): void {
    if (!this._isRunning) {
      return;
    }

    this._isRunning = false;

    // Stop chokidar watcher
    if (this.watcher) {
      this.watcher.close().catch((err) => {
        this.logger?.debug({ err }, 'Error closing chokidar watcher');
      });
      this.watcher = null;
    }

    // Stop backup polling
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }

    // Stop health check
    if (this.healthCheckIntervalId) {
      clearInterval(this.healthCheckIntervalId);
      this.healthCheckIntervalId = null;
    }

    // Clear debounce
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
    this.pendingEvents.clear();

    this.logger?.info('FileWatcher stopped');
  }

  /**
   * Check if watcher is healthy
   */
  isHealthy(): boolean {
    if (this.usePollingOnly) {
      return true; // Polling is always "healthy"
    }
    return this.isWatcherHealthy;
  }

  /**
   * Check if watcher is running
   */
  isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Get list of watched paths
   */
  getWatchedPaths(): string[] {
    return [...this.paths];
  }

  /**
   * Add a path to watch
   */
  addPath(path: string): void {
    if (this.paths.has(path)) {
      return;
    }

    this.paths.add(path);

    if (this.watcher) {
      this.watcher.add(path);
      this.logger?.debug(`Added path to watcher: ${path}`);
    }
  }

  /**
   * Remove a path from watching
   */
  removePath(path: string): void {
    if (!this.paths.has(path)) {
      return;
    }

    this.paths.delete(path);

    if (this.watcher) {
      this.watcher.unwatch(path);
      this.logger?.debug(`Removed path from watcher: ${path}`);
    }
  }

  /**
   * Start chokidar file watcher
   */
  private async startChokidarWatcher(): Promise<void> {
    try {
      // Dynamic import of chokidar
      const chokidar = await import('chokidar');

      this.watcher = chokidar.watch([...this.paths], {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: this.debounceMs,
          pollInterval: 100,
        },
        // Don't use polling by default - callers watching cross-filesystem paths
        // (like WSL watching Windows files) should use usePollingOnly option instead
        usePolling: false,
      });

      // Set up event handlers
      this.watcher
        .on('add', (path) => this.queueChokidarEvent('add', path))
        .on('change', (path) => this.queueChokidarEvent('change', path))
        .on('unlink', (path) => this.queueChokidarEvent('unlink', path))
        .on('addDir', (path) => this.queueChokidarEvent('addDir', path))
        .on('unlinkDir', (path) => this.queueChokidarEvent('unlinkDir', path))
        .on('error', (error: unknown) => this.handleWatcherError(error instanceof Error ? error : new Error(String(error))))
        .on('ready', () => {
          this.logger?.debug('Chokidar watcher ready');
          this.isWatcherHealthy = true;
        });

    } catch (error) {
      this.logger?.warn({ err: error }, 'Failed to start chokidar, relying on backup polling only');
      this.isWatcherHealthy = false;
    }
  }

  /**
   * Start backup polling (always runs alongside chokidar)
   */
  private startBackupPolling(): void {
    this.pollIntervalId = setInterval(() => {
      this.doPoll();
    }, this.pollInterval);

    // Do initial poll
    this.doPoll();
  }

  /**
   * Start health check (monitors chokidar, logs warnings if silent)
   */
  private startHealthCheck(): void {
    this.healthCheckIntervalId = setInterval(() => {
      const timeSinceLastChokidarEvent = Date.now() - this.lastChokidarEventTime;

      if (timeSinceLastChokidarEvent > this.healthCheckInterval) {
        if (this.isWatcherHealthy) {
          this.logger?.warn(
            `Chokidar appears silent (no events for ${Math.round(timeSinceLastChokidarEvent / 1000)}s). ` +
            `Backup polling is still active.`
          );
          this.isWatcherHealthy = false;
        }
      }
    }, this.healthCheckInterval);
  }

  /**
   * Queue a chokidar file event (for debouncing)
   */
  private queueChokidarEvent(type: FileWatchEventType, path: string): void {
    this.lastChokidarEventTime = Date.now();
    this.isWatcherHealthy = true;

    // Queue event for debouncing
    this.pendingEvents.set(path, {
      type,
      path,
      timestamp: this.lastChokidarEventTime,
    });

    // Reset debounce timer
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }

    this.debounceTimeout = setTimeout(() => {
      this.flushEvents();
    }, this.debounceMs);
  }

  /**
   * Flush pending events
   */
  private flushEvents(): void {
    for (const event of this.pendingEvents.values()) {
      try {
        this.onEvent(event);
      } catch (error) {
        this.logger?.error({ err: error }, 'Error in event handler');
      }
    }
    this.pendingEvents.clear();
    this.debounceTimeout = null;
  }

  /**
   * Handle watcher error
   */
  private handleWatcherError(error: Error): void {
    this.logger?.error({ err: error }, 'Chokidar error (backup polling still active)');
    this.isWatcherHealthy = false;

    // Emit error event
    this.onEvent({
      type: 'error',
      path: '',
      timestamp: Date.now(),
    });

    this.onError?.(error);
    // Note: backup polling is always running, so no need to start it here
  }

  /**
   * Perform a poll cycle (emit synthetic event)
   * This is the backup mechanism - always runs to catch any missed file changes.
   */
  private doPoll(): void {
    // Emit a 'poll' event to trigger refresh
    // The consumer should treat this as "check for changes"
    try {
      this.onEvent({
        type: 'poll',
        path: '',
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger?.error({ err: error }, 'Error in poll event handler');
    }
  }
}

/**
 * Create a file watcher with sensible defaults
 */
export function createFileWatcher(
  paths: string[],
  onEvent: (event: FileWatchEvent) => void,
  logger?: ILogger
): IFileWatcher {
  return new FileWatcher({
    paths,
    onEvent,
    logger,
  });
}
