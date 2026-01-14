/**
 * Logger - Simple pino wrapper
 *
 * Just a factory function to create configured pino loggers.
 * Uses pino directly - no unnecessary abstraction.
 */

import pino from 'pino';
import * as fs from 'fs';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Re-export pino's Logger type for use throughout the codebase */
export type { Logger as ILogger } from 'pino';

/**
 * Create a pino logger that writes to a file.
 *
 * @param logDir - Directory for log files (creates opus.log inside)
 * @param level - Minimum log level
 * @returns Configured pino logger
 */
export function createLogger(logDir: string, level: LogLevel = 'debug'): pino.Logger {
  // Ensure directory exists, fall back to temp if it fails
  let effectiveDir = logDir;
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    effectiveDir = require('os').tmpdir();
  }

  const logPath = `${effectiveDir}/opus.log`;

  return pino(
    {
      level,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.destination({ dest: logPath, sync: true })
  );
}

/**
 * Create a silent logger for testing.
 */
export function createNullLogger(): pino.Logger {
  return pino({ level: 'silent' });
}

