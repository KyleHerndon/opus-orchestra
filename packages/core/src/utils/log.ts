/**
 * Global logging utility
 *
 * Provides a simple `log` object that can be used anywhere without setup.
 * Buffers messages until a real logger is attached, then flushes.
 *
 * Usage:
 *   import { log } from '@opus-orchestra/core';
 *   log.debug('message');
 *   log.info({ foo: 'bar' }, 'structured message');
 */

import type { Logger as ILogger } from 'pino';

interface BufferedLog {
  level: 'debug' | 'info' | 'warn' | 'error';
  args: unknown[];
  timestamp: number;
}

const MAX_BUFFER_SIZE = 1000;
let _logger: ILogger | null = null;
let _buffer: BufferedLog[] = [];

/**
 * Attach a real logger. Flushes any buffered messages.
 */
export function setGlobalLogger(logger: ILogger): void {
  _logger = logger;

  // Flush buffer
  for (const { level, args } of _buffer) {
    (_logger[level] as (...args: unknown[]) => void)(...args);
  }
  _buffer = [];
}

/**
 * Detach the logger (mainly for testing)
 */
export function clearGlobalLogger(): void {
  _logger = null;
  _buffer = [];
}

/**
 * Check if a real logger is attached
 */
export function isLoggerAttached(): boolean {
  return _logger !== null;
}

function logAt(level: 'debug' | 'info' | 'warn' | 'error', ...args: unknown[]): void {
  if (_logger) {
    (_logger[level] as (...args: unknown[]) => void)(...args);
  } else {
    // Buffer until logger is attached
    if (_buffer.length < MAX_BUFFER_SIZE) {
      _buffer.push({ level, args, timestamp: Date.now() });
    }
    // Silently drop if buffer is full - don't want to crash on logging
  }
}

/**
 * Global log object - always safe to use
 */
export const log = {
  debug: (...args: unknown[]) => logAt('debug', ...args),
  info: (...args: unknown[]) => logAt('info', ...args),
  warn: (...args: unknown[]) => logAt('warn', ...args),
  error: (...args: unknown[]) => logAt('error', ...args),

  /**
   * Create a child logger with component context.
   * If no logger attached yet, returns a proxy that will use the context when logger is attached.
   */
  child(bindings: Record<string, unknown>) {
    if (_logger) {
      const childLogger = _logger.child(bindings);
      return {
        debug: (...args: unknown[]) => (childLogger.debug as (...args: unknown[]) => void)(...args),
        info: (...args: unknown[]) => (childLogger.info as (...args: unknown[]) => void)(...args),
        warn: (...args: unknown[]) => (childLogger.warn as (...args: unknown[]) => void)(...args),
        error: (...args: unknown[]) => (childLogger.error as (...args: unknown[]) => void)(...args),
      };
    }
    // Before logger attached, just add bindings to each log call
    return {
      debug: (...args: unknown[]) => logAt('debug', bindings, ...args),
      info: (...args: unknown[]) => logAt('info', bindings, ...args),
      warn: (...args: unknown[]) => logAt('warn', bindings, ...args),
      error: (...args: unknown[]) => logAt('error', bindings, ...args),
    };
  },
};
