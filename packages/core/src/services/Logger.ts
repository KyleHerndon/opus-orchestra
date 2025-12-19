/**
 * Logger Service
 *
 * Provides structured logging with file output for debugging.
 * This is a low-level service that uses direct fs operations
 * since it needs to work before other services are initialized.
 */

import * as fs from 'fs';
import * as path from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger interface for dependency injection
 */
export interface ILogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, error?: Error, ...args: unknown[]): void;
  child(context: string): ILogger;
}

/**
 * Logger implementation
 */
export class Logger implements ILogger {
  private logFile: string;
  private minLevel: LogLevel;
  private context: string;

  private static readonly LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(logFilePath: string, context: string = 'Core', minLevel: LogLevel = 'debug') {
    this.logFile = logFilePath;
    this.context = context;
    this.minLevel = minLevel;
  }

  /**
   * Create a child logger with a specific context
   */
  child(context: string): Logger {
    const child = new Logger(this.logFile, context, this.minLevel);
    return child;
  }

  /**
   * Set minimum log level
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Log a debug message
   */
  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, ...args);
  }

  /**
   * Log an info message
   */
  info(message: string, ...args: unknown[]): void {
    this.log('info', message, ...args);
  }

  /**
   * Log a warning message
   */
  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, ...args);
  }

  /**
   * Log an error message
   */
  error(message: string, error?: Error, ...args: unknown[]): void {
    if (error) {
      this.log('error', `${message}: ${error.message}`, ...args);
      if (error.stack) {
        this.log('error', `Stack: ${error.stack}`);
      }
    } else {
      this.log('error', message, ...args);
    }
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (Logger.LEVEL_PRIORITY[level] < Logger.LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ` ${this.formatArgs(args)}` : '';
    const logLine = `[${timestamp}] [${level.toUpperCase()}] [${this.context}] ${message}${formattedArgs}\n`;

    try {
      fs.appendFileSync(this.logFile, logLine);
    } catch {
      // Can't log errors about logging
    }
  }

  /**
   * Format additional arguments
   */
  private formatArgs(args: unknown[]): string {
    return args.map(arg => {
      if (arg === null) { return 'null'; }
      if (arg === undefined) { return 'undefined'; }
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return '[Object]';
        }
      }
      return String(arg);
    }).join(' ');
  }

  /**
   * Clear the log file
   */
  clear(): void {
    try {
      fs.writeFileSync(this.logFile, '');
    } catch {
      // Ignore errors
    }
  }

  /**
   * Get the log file path
   */
  getLogFilePath(): string {
    return this.logFile;
  }
}

/**
 * Create a logger with the given log file path
 */
export function createLogger(logFilePath: string, minLevel: LogLevel = 'debug'): Logger {
  return new Logger(logFilePath, 'Core', minLevel);
}

/**
 * No-op logger for testing or when logging is disabled
 */
export class NullLogger implements ILogger {
  debug(): void { /* no-op */ }
  info(): void { /* no-op */ }
  warn(): void { /* no-op */ }
  error(): void { /* no-op */ }
  child(): ILogger { return this; }
}
