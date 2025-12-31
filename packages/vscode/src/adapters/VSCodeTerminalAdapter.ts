/**
 * VSCodeTerminalAdapter - VS Code terminal adapter
 *
 * Implements TerminalAdapter using VS Code's terminal API.
 */

import * as vscode from 'vscode';
import {
  TerminalAdapter,
  TerminalHandle,
  CreateTerminalOptions,
  TerminalCloseCallback,
  SystemAdapter,
} from '@opus-orchestra/core';

/**
 * Internal mapping from terminal ID to VS Code terminal.
 */
const terminalMap = new Map<string, vscode.Terminal>();

/**
 * Counter for generating unique terminal IDs.
 */
let terminalIdCounter = 0;

/**
 * VS Code terminal adapter.
 * Uses vscode.window for terminal management.
 */
export class VSCodeTerminalAdapter implements TerminalAdapter {
  private closeCallbacks: Set<TerminalCloseCallback> = new Set();
  private openCallbacks: Set<(terminal: TerminalHandle) => void> = new Set();
  private disposables: vscode.Disposable[] = [];
  private system: SystemAdapter;

  constructor(system: SystemAdapter) {
    this.system = system;
    this.setupListeners();
  }

  private setupListeners(): void {
    // Listen for terminal close events
    this.disposables.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        // Find the handle for this terminal
        for (const [id, t] of terminalMap.entries()) {
          if (t === terminal) {
            const handle: TerminalHandle = { id, name: terminal.name };
            terminalMap.delete(id);
            for (const callback of this.closeCallbacks) {
              callback(handle);
            }
            break;
          }
        }
      })
    );

    // Listen for terminal open events
    this.disposables.push(
      vscode.window.onDidOpenTerminal((terminal) => {
        // Check if we already have this terminal mapped
        for (const t of terminalMap.values()) {
          if (t === terminal) {
            return; // Already tracked
          }
        }

        // Create a handle for externally opened terminals
        const id = `external-${++terminalIdCounter}`;
        terminalMap.set(id, terminal);
        const handle: TerminalHandle = { id, name: terminal.name };

        for (const callback of this.openCallbacks) {
          callback(handle);
        }
      })
    );
  }

  createTerminal(options: CreateTerminalOptions): TerminalHandle {
    // Convert cwd path if provided
    const cwd = options.cwd
      ? this.system.convertPath(options.cwd, 'nodeFs')
      : undefined;

    const terminalOptions: vscode.TerminalOptions = {
      name: options.name,
      cwd,
      env: options.env,
      shellPath: options.shellPath,
      shellArgs: options.shellArgs,
      iconPath: options.iconId ? new vscode.ThemeIcon(options.iconId) : undefined,
    };

    const terminal = vscode.window.createTerminal(terminalOptions);
    const id = `terminal-${++terminalIdCounter}`;
    terminalMap.set(id, terminal);

    return { id, name: options.name };
  }

  sendText(terminal: TerminalHandle, text: string, addNewline = true): void {
    const vscodeTerminal = terminalMap.get(terminal.id);
    if (vscodeTerminal) {
      vscodeTerminal.sendText(text, addNewline);
    }
  }

  dispose(terminal: TerminalHandle): void {
    const vscodeTerminal = terminalMap.get(terminal.id);
    if (vscodeTerminal) {
      vscodeTerminal.dispose();
      terminalMap.delete(terminal.id);
    }
  }

  findByName(name: string): TerminalHandle | undefined {
    // First check our map
    for (const [id, terminal] of terminalMap.entries()) {
      if (terminal.name === name) {
        return { id, name };
      }
    }

    // Check VS Code's terminals for any we might have missed
    const terminal = vscode.window.terminals.find((t) => t.name === name);
    if (terminal) {
      // Add to our map
      const id = `found-${++terminalIdCounter}`;
      terminalMap.set(id, terminal);
      return { id, name };
    }

    return undefined;
  }

  isAlive(terminal: TerminalHandle): boolean {
    const vscodeTerminal = terminalMap.get(terminal.id);
    if (!vscodeTerminal) {
      return false;
    }
    // Check if terminal is still in VS Code's list
    return vscode.window.terminals.includes(vscodeTerminal);
  }

  show(terminal: TerminalHandle, preserveFocus = false): void {
    const vscodeTerminal = terminalMap.get(terminal.id);
    if (vscodeTerminal) {
      vscodeTerminal.show(preserveFocus);
    }
  }

  getAll(): TerminalHandle[] {
    const handles: TerminalHandle[] = [];

    // Ensure all VS Code terminals are in our map
    for (const terminal of vscode.window.terminals) {
      let found = false;
      for (const [id, t] of terminalMap.entries()) {
        if (t === terminal) {
          handles.push({ id, name: terminal.name });
          found = true;
          break;
        }
      }
      if (!found) {
        const id = `sync-${++terminalIdCounter}`;
        terminalMap.set(id, terminal);
        handles.push({ id, name: terminal.name });
      }
    }

    return handles;
  }

  onDidClose(callback: TerminalCloseCallback): () => void {
    this.closeCallbacks.add(callback);
    return () => {
      this.closeCallbacks.delete(callback);
    };
  }

  onDidOpen(callback: (terminal: TerminalHandle) => void): () => void {
    this.openCallbacks.add(callback);
    return () => {
      this.openCallbacks.delete(callback);
    };
  }

  /**
   * Get the underlying VS Code terminal for a handle.
   * Used for VS Code-specific operations not covered by the interface.
   */
  getVSCodeTerminal(handle: TerminalHandle): vscode.Terminal | undefined {
    return terminalMap.get(handle.id);
  }

  /**
   * Dispose resources (call when extension deactivates).
   */
  disposeAll(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    this.closeCallbacks.clear();
    this.openCallbacks.clear();
    terminalMap.clear();
  }
}
