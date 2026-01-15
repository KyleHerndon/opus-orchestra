/**
 * Logger - Simple pino wrapper with subscribable log streams
 *
 * Provides:
 * - File logging via pino
 * - Subscribable streams that filter by log level
 *
 * Example: Subscribe to error/warn for UI display:
 *   const uiStream = new LogStream(['error', 'warn']);
 *   const logger = createLoggerWithStreams(logDir, 'debug', [uiStream]);
 *   uiStream.on('entry', (entry) => updateDashboard(entry));
 */

import pino from 'pino';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { Writable } from 'stream';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Re-export pino's Logger type for use throughout the codebase */
export type { Logger as ILogger } from 'pino';

/**
 * A log entry
 */
export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
}

/**
 * Subscribable log stream that filters by level.
 * Emits 'entry' events for matching log messages.
 */
export class LogStream extends EventEmitter {
  private levels: Set<LogLevel>;
  private lastEntry: LogEntry | null = null;

  /**
   * @param levels - Log levels to capture (e.g., ['error', 'warn'])
   */
  constructor(levels: LogLevel[]) {
    super();
    this.levels = new Set(levels);
  }

  /**
   * Check if this stream captures the given level
   */
  capturesLevel(level: LogLevel): boolean {
    return this.levels.has(level);
  }

  /**
   * Process a log entry (called internally by the pino stream)
   */
  processEntry(entry: LogEntry): void {
    this.lastEntry = entry;
    this.emit('entry', entry);
  }

  /**
   * Get the last captured entry
   */
  getLastEntry(): LogEntry | null {
    return this.lastEntry;
  }

  /**
   * Clear the last entry
   */
  clearLastEntry(): void {
    this.lastEntry = null;
    this.emit('clear');
  }
}

/**
 * Create a writable stream that routes to LogStream instances
 */
function createMultiWritable(logStreams: LogStream[]): Writable {
  return new Writable({
    objectMode: true,
    write(chunk: string, _encoding, callback) {
      try {
        const obj = JSON.parse(chunk);
        const level = pino.levels.labels[obj.level] as LogLevel;
        const entry: LogEntry = {
          timestamp: new Date(obj.time),
          level,
          message: obj.msg || '',
        };

        for (const stream of logStreams) {
          if (stream.capturesLevel(level)) {
            stream.processEntry(entry);
          }
        }
      } catch {
        // Ignore parse errors
      }
      callback();
    },
  });
}

/**
 * Create a pino logger that writes to a file.
 *
 * @param logDir - Directory for log files (creates orchestra.log inside)
 * @param level - Minimum log level
 * @returns Configured pino logger
 */
export function createLogger(logDir: string, level: LogLevel = 'debug'): pino.Logger {
  return createLoggerWithStreams(logDir, level, []);
}

/**
 * Create a pino logger with additional subscribable streams.
 *
 * @param logDir - Directory for log files
 * @param level - Minimum log level
 * @param logStreams - Additional LogStream instances to receive filtered entries
 * @returns Configured pino logger
 */
export function createLoggerWithStreams(
  logDir: string,
  level: LogLevel = 'debug',
  logStreams: LogStream[] = []
): pino.Logger {
  // Ensure directory exists, fall back to temp if it fails
  let effectiveDir = logDir;
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    effectiveDir = require('os').tmpdir();
  }

  const logPath = `${effectiveDir}/orchestra.log`;

  // Build streams array
  const streams: pino.StreamEntry[] = [
    { stream: pino.destination({ dest: logPath, sync: true }) },
  ];

  // Add multi-stream for LogStream instances if any
  if (logStreams.length > 0) {
    streams.push({
      level: 'debug', // Capture all, filtering happens per-stream
      stream: createMultiWritable(logStreams),
    });
  }

  return pino(
    {
      level,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream(streams)
  );
}

/**
 * Create a silent logger for testing.
 */
export function createNullLogger(): pino.Logger {
  return pino({ level: 'silent' });
}

