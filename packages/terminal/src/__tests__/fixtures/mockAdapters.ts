/**
 * Mock adapters for testing
 */

import type {
  SystemAdapter,
  UIAdapter,
  TerminalAdapter,
  TerminalHandle,
  CreateTerminalOptions,
  TerminalCloseCallback,
  QuickPickItem,
  QuickPickOptions,
  InputOptions,
  ProgressOptions,
  ProgressReporter,
  CancellationToken,
} from '@opus-orchestra/core';

/**
 * Mock SystemAdapter that records calls and returns configurable responses.
 */
export class MockSystemAdapter implements SystemAdapter {
  public calls: { method: string; args: unknown[] }[] = [];
  public execResponses: Map<string, string> = new Map();
  public execErrors: Map<string, Error> = new Map();

  terminalType: 'vscode' | 'system' = 'system';

  async exec(command: string, cwd: string): Promise<string> {
    this.calls.push({ method: 'exec', args: [command, cwd] });

    // Check for configured error
    for (const [pattern, error] of this.execErrors) {
      if (command.includes(pattern)) {
        throw error;
      }
    }

    // Check for configured response
    for (const [pattern, response] of this.execResponses) {
      if (command.includes(pattern)) {
        return response;
      }
    }

    // Default empty response
    return '';
  }

  spawn(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string> }
  ): { stdout: AsyncIterable<string>; exitCode: Promise<number> } {
    this.calls.push({ method: 'spawn', args: [command, args, options] });

    return {
      stdout: (async function* () {
        yield '';
      })(),
      exitCode: Promise.resolve(0),
    };
  }

  fileExists(path: string): boolean {
    this.calls.push({ method: 'fileExists', args: [path] });
    return false;
  }

  directoryExists(path: string): boolean {
    this.calls.push({ method: 'directoryExists', args: [path] });
    return false;
  }

  readFile(path: string): string {
    this.calls.push({ method: 'readFile', args: [path] });
    return '';
  }

  writeFile(path: string, content: string): void {
    this.calls.push({ method: 'writeFile', args: [path, content] });
  }

  createDirectory(path: string): void {
    this.calls.push({ method: 'createDirectory', args: [path] });
  }

  deleteFile(path: string): void {
    this.calls.push({ method: 'deleteFile', args: [path] });
  }

  deleteDirectory(path: string): void {
    this.calls.push({ method: 'deleteDirectory', args: [path] });
  }

  listDirectory(path: string): string[] {
    this.calls.push({ method: 'listDirectory', args: [path] });
    return [];
  }

  joinPath(...segments: string[]): string {
    this.calls.push({ method: 'joinPath', args: segments });
    return segments.join('/');
  }

  resolvePath(path: string): string {
    this.calls.push({ method: 'resolvePath', args: [path] });
    return path;
  }

  getParentPath(path: string): string {
    this.calls.push({ method: 'getParentPath', args: [path] });
    const parts = path.split('/');
    parts.pop();
    return parts.join('/');
  }

  getBaseName(path: string): string {
    this.calls.push({ method: 'getBaseName', args: [path] });
    return path.split('/').pop() || '';
  }

  reset(): void {
    this.calls = [];
    this.execResponses.clear();
    this.execErrors.clear();
  }
}

/**
 * Mock UIAdapter that records calls and can be configured with responses.
 */
export class MockUIAdapter implements UIAdapter {
  public calls: { method: string; args: unknown[] }[] = [];
  public confirmResponse = true;
  public inputResponse: string | undefined = undefined;
  public quickPickResponse: string | string[] | undefined = undefined;

  async showInfo(message: string, ...items: string[]): Promise<string | undefined> {
    this.calls.push({ method: 'showInfo', args: [message, ...items] });
    return items.length > 0 ? items[0] : undefined;
  }

  async showWarning(message: string, ...items: string[]): Promise<string | undefined> {
    this.calls.push({ method: 'showWarning', args: [message, ...items] });
    return items.length > 0 ? items[0] : undefined;
  }

  async showError(message: string, ...items: string[]): Promise<string | undefined> {
    this.calls.push({ method: 'showError', args: [message, ...items] });
    return items.length > 0 ? items[0] : undefined;
  }

  async promptInput(options: InputOptions): Promise<string | undefined> {
    this.calls.push({ method: 'promptInput', args: [options] });
    return this.inputResponse;
  }

  async promptQuickPick(
    items: QuickPickItem[],
    options?: QuickPickOptions
  ): Promise<string | string[] | undefined> {
    this.calls.push({ method: 'promptQuickPick', args: [items, options] });
    return this.quickPickResponse;
  }

  async confirm(
    message: string,
    confirmLabel?: string,
    cancelLabel?: string
  ): Promise<boolean> {
    this.calls.push({ method: 'confirm', args: [message, confirmLabel, cancelLabel] });
    return this.confirmResponse;
  }

  async withProgress<T>(
    options: ProgressOptions,
    task: (progress: ProgressReporter, token: CancellationToken) => Promise<T>
  ): Promise<T> {
    this.calls.push({ method: 'withProgress', args: [options] });

    const token: CancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: () => () => {},
    };

    const progress: ProgressReporter = {
      report: () => {},
    };

    return task(progress, token);
  }

  setStatusMessage(message: string, timeout?: number): () => void {
    this.calls.push({ method: 'setStatusMessage', args: [message, timeout] });
    return () => {};
  }

  reset(): void {
    this.calls = [];
    this.confirmResponse = true;
    this.inputResponse = undefined;
    this.quickPickResponse = undefined;
  }
}

/**
 * Mock TerminalAdapter for testing terminal operations.
 */
export class MockTerminalAdapter implements TerminalAdapter {
  public calls: { method: string; args: unknown[] }[] = [];
  public terminals: Map<string, TerminalHandle & { alive: boolean; sentText: string[] }> = new Map();
  public closeCallbacks: Set<TerminalCloseCallback> = new Set();
  private nextId = 1;

  createTerminal(options: CreateTerminalOptions): TerminalHandle {
    this.calls.push({ method: 'createTerminal', args: [options] });

    const id = `mock-terminal-${this.nextId++}`;
    const terminal = {
      id,
      name: options.name,
      alive: true,
      sentText: [],
    };

    this.terminals.set(id, terminal);
    return terminal;
  }

  sendText(terminal: TerminalHandle, text: string, addNewline?: boolean): void {
    this.calls.push({ method: 'sendText', args: [terminal, text, addNewline] });

    const t = this.terminals.get(terminal.id);
    if (t) {
      t.sentText.push(text);
    }
  }

  dispose(terminal: TerminalHandle): void {
    this.calls.push({ method: 'dispose', args: [terminal] });

    const t = this.terminals.get(terminal.id);
    if (t) {
      t.alive = false;
      this.terminals.delete(terminal.id);

      for (const callback of this.closeCallbacks) {
        callback(terminal);
      }
    }
  }

  findByName(name: string): TerminalHandle | undefined {
    this.calls.push({ method: 'findByName', args: [name] });

    for (const terminal of this.terminals.values()) {
      if (terminal.name === name) {
        return terminal;
      }
    }
    return undefined;
  }

  isAlive(terminal: TerminalHandle): boolean {
    this.calls.push({ method: 'isAlive', args: [terminal] });
    return this.terminals.get(terminal.id)?.alive ?? false;
  }

  show(terminal: TerminalHandle, preserveFocus?: boolean): void {
    this.calls.push({ method: 'show', args: [terminal, preserveFocus] });
  }

  getAll(): TerminalHandle[] {
    this.calls.push({ method: 'getAll', args: [] });
    return Array.from(this.terminals.values()).filter((t) => t.alive);
  }

  onDidClose(callback: TerminalCloseCallback): () => void {
    this.calls.push({ method: 'onDidClose', args: [] });
    this.closeCallbacks.add(callback);
    return () => {
      this.closeCallbacks.delete(callback);
    };
  }

  reset(): void {
    this.calls = [];
    this.terminals.clear();
    this.closeCallbacks.clear();
    this.nextId = 1;
  }
}
