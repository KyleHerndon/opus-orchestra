/**
 * TmuxControlWatcher - Monitor tmux sessions via control mode
 *
 * Uses tmux control mode (-C) to receive real-time notifications
 * when panes produce output. This enables detecting when a user
 * responds to a permission prompt without polling.
 *
 * Control mode provides a machine-readable event stream including:
 * - %output pane-id value - When a pane produces output
 * - %session-changed - When session changes
 * - %exit - When the control client exits
 */

import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { ILogger } from './Logger';

export interface TmuxOutputEvent {
  paneId: string;
  output: string;
  sessionName: string;
}

export interface ITmuxControlWatcher extends EventEmitter {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  on(event: 'output', listener: (data: TmuxOutputEvent) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number | null) => void): this;
}

/**
 * Watches a tmux session via control mode for output events
 */
export class TmuxControlWatcher extends EventEmitter implements ITmuxControlWatcher {
  private sessionName: string;
  private logger?: ILogger;
  private process: ChildProcess | null = null;
  private buffer: string = '';

  constructor(sessionName: string, logger?: ILogger) {
    super();
    this.sessionName = sessionName;
    this.logger = logger?.child({ component: 'TmuxControlWatcher', session: sessionName });
  }

  /**
   * Start watching the tmux session in control mode
   */
  start(): void {
    if (this.process) {
      this.logger?.debug('Watcher already running');
      return;
    }

    this.logger?.debug(`Starting control mode watcher for session: ${this.sessionName}`);

    try {
      // Spawn tmux in control mode, attached to the target session
      this.process = spawn('tmux', ['-C', 'attach-session', '-t', this.sessionName], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleData(data.toString());
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        this.logger?.debug(`Control mode stderr: ${data.toString().trim()}`);
      });

      this.process.on('error', (error: Error) => {
        this.logger?.error({ err: error }, 'Control mode process error');
        this.emit('error', error);
      });

      this.process.on('exit', (code: number | null) => {
        this.logger?.debug(`Control mode process exited with code: ${code}`);
        this.process = null;
        this.emit('exit', code);
      });

    } catch (error) {
      this.logger?.error({ err: error }, 'Failed to start control mode watcher');
      throw error;
    }
  }

  /**
   * Stop watching the tmux session
   */
  stop(): void {
    if (!this.process) {
      return;
    }

    this.logger?.debug('Stopping control mode watcher');

    // Send quit command to gracefully exit control mode
    this.process.stdin?.write('quit\n');

    // Give it a moment to exit gracefully, then force kill
    setTimeout(() => {
      if (this.process) {
        this.process.kill('SIGTERM');
        this.process = null;
      }
    }, 500);
  }

  /**
   * Check if the watcher is currently running
   */
  isRunning(): boolean {
    return this.process !== null;
  }

  /**
   * Handle incoming data from control mode
   */
  private handleData(data: string): void {
    // Buffer data in case messages are split across chunks
    this.buffer += data;

    // Process complete lines
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      this.parseLine(line);
    }
  }

  /**
   * Parse a single line of control mode output
   */
  private parseLine(line: string): void {
    // Skip empty lines
    if (!line.trim()) {
      return;
    }

    // Parse %output events: %output pane-id value
    const outputMatch = line.match(/^%output (%\d+) (.*)$/);
    if (outputMatch) {
      const [, paneId, rawValue] = outputMatch;
      // Unescape octal sequences (tmux escapes non-printable chars as \xxx)
      const output = this.unescapeOctal(rawValue);

      this.emit('output', {
        paneId,
        output,
        sessionName: this.sessionName,
      });
      return;
    }

    // Parse %extended-output events (newer tmux)
    const extOutputMatch = line.match(/^%extended-output (%\d+) \d+ : (.*)$/);
    if (extOutputMatch) {
      const [, paneId, rawValue] = extOutputMatch;
      const output = this.unescapeOctal(rawValue);

      this.emit('output', {
        paneId,
        output,
        sessionName: this.sessionName,
      });
      return;
    }

    // Log other control mode messages for debugging
    if (line.startsWith('%')) {
      this.logger?.debug(`Control mode event: ${line.substring(0, 100)}`);
    }
  }

  /**
   * Unescape octal sequences in tmux output
   * tmux escapes non-printable characters as \xxx (octal)
   */
  private unescapeOctal(str: string): string {
    return str.replace(/\\([0-7]{3})/g, (_, octal) => {
      return String.fromCharCode(parseInt(octal, 8));
    });
  }
}

/**
 * Manages multiple TmuxControlWatcher instances
 */
export class TmuxControlWatcherManager {
  private watchers: Map<string, TmuxControlWatcher> = new Map();
  private logger?: ILogger;

  constructor(logger?: ILogger) {
    this.logger = logger?.child({ component: 'TmuxControlWatcherManager' });
  }

  /**
   * Get or create a watcher for a session
   */
  getWatcher(sessionName: string): TmuxControlWatcher {
    let watcher = this.watchers.get(sessionName);
    if (!watcher) {
      watcher = new TmuxControlWatcher(sessionName, this.logger);
      this.watchers.set(sessionName, watcher);

      // Clean up when watcher exits
      watcher.on('exit', () => {
        this.watchers.delete(sessionName);
      });
    }
    return watcher;
  }

  /**
   * Start watching a session
   */
  startWatching(sessionName: string): TmuxControlWatcher {
    const watcher = this.getWatcher(sessionName);
    if (!watcher.isRunning()) {
      watcher.start();
    }
    return watcher;
  }

  /**
   * Stop watching a session
   */
  stopWatching(sessionName: string): void {
    const watcher = this.watchers.get(sessionName);
    if (watcher) {
      watcher.stop();
      this.watchers.delete(sessionName);
    }
  }

  /**
   * Stop all watchers
   */
  stopAll(): void {
    for (const watcher of this.watchers.values()) {
      watcher.stop();
    }
    this.watchers.clear();
  }

  /**
   * Check if a session is being watched
   */
  isWatching(sessionName: string): boolean {
    const watcher = this.watchers.get(sessionName);
    return watcher?.isRunning() ?? false;
  }
}
