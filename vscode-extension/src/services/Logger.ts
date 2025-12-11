/**
 * Logger Service
 *
 * Provides structured logging with file output for debugging.
 * VS Code extension console.log output is not accessible,
 * so this writes to a debug.log file in the extension directory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ILogger } from '../types';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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

    constructor(extensionPath: string, context: string = 'Extension', minLevel: LogLevel = 'debug') {
        this.logFile = path.join(extensionPath, 'debug.log');
        this.context = context;
        this.minLevel = minLevel;
    }

    /**
     * Create a child logger with a specific context
     */
    child(context: string): Logger {
        const child = new Logger(path.dirname(this.logFile), context, this.minLevel);
        child.logFile = this.logFile; // Share the same log file
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
            if (arg === null) return 'null';
            if (arg === undefined) return 'undefined';
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
 * Global logger instance
 */
let loggerInstance: Logger | null = null;

/**
 * Initialize the global logger
 */
export function initLogger(extensionPath: string, minLevel: LogLevel = 'debug'): Logger {
    loggerInstance = new Logger(extensionPath, 'Extension', minLevel);
    return loggerInstance;
}

/**
 * Get the global logger instance
 */
export function getLogger(): Logger {
    if (!loggerInstance) {
        throw new Error('Logger not initialized. Call initLogger first.');
    }
    return loggerInstance;
}

/**
 * Check if logger is initialized
 */
export function isLoggerInitialized(): boolean {
    return loggerInstance !== null;
}
