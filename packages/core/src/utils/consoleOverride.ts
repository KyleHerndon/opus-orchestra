/**
 * Console override - redirects console.* to the global logger
 *
 * Call overrideConsole() early in your app's startup to redirect
 * all console.log/warn/error calls to the structured logger.
 *
 * For intentional stdout output, use print() from './print.ts' instead.
 */

/* eslint-disable no-console */

import { log } from './log';

// Store originals for restoration (useful in tests)
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
  info: console.info,
};

let _overridden = false;

/**
 * Override console methods to use the global logger.
 * Safe to call multiple times - only overrides once.
 */
export function overrideConsole(): void {
  if (_overridden) {return;}

  console.log = (...args: unknown[]) => log.debug(...args);
  console.debug = (...args: unknown[]) => log.debug(...args);
  console.info = (...args: unknown[]) => log.info(...args);
  console.warn = (...args: unknown[]) => log.warn(...args);
  console.error = (...args: unknown[]) => log.error(...args);

  _overridden = true;
}

/**
 * Restore original console methods.
 * Mainly useful for testing.
 */
export function restoreConsole(): void {
  if (!_overridden) {return;}

  console.log = originalConsole.log;
  console.debug = originalConsole.debug;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;

  _overridden = false;
}

/**
 * Check if console is currently overridden
 */
export function isConsoleOverridden(): boolean {
  return _overridden;
}
