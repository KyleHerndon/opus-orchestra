/**
 * Mock adapters for testing
 */
import type { SystemAdapter, UIAdapter, TerminalAdapter, TerminalHandle, CreateTerminalOptions, TerminalCloseCallback, QuickPickItem, QuickPickOptions, InputOptions, ProgressOptions, ProgressReporter, CancellationToken } from '@opus-orchestra/core';
/**
 * Mock SystemAdapter that records calls and returns configurable responses.
 */
export declare class MockSystemAdapter implements SystemAdapter {
    calls: {
        method: string;
        args: unknown[];
    }[];
    execResponses: Map<string, string>;
    execErrors: Map<string, Error>;
    terminalType: 'vscode' | 'system';
    exec(command: string, cwd: string): Promise<string>;
    spawn(command: string, args: string[], options?: {
        cwd?: string;
        env?: Record<string, string>;
    }): {
        stdout: AsyncIterable<string>;
        exitCode: Promise<number>;
    };
    fileExists(path: string): boolean;
    directoryExists(path: string): boolean;
    readFile(path: string): string;
    writeFile(path: string, content: string): void;
    createDirectory(path: string): void;
    deleteFile(path: string): void;
    deleteDirectory(path: string): void;
    listDirectory(path: string): string[];
    joinPath(...segments: string[]): string;
    resolvePath(path: string): string;
    getParentPath(path: string): string;
    getBaseName(path: string): string;
    reset(): void;
}
/**
 * Mock UIAdapter that records calls and can be configured with responses.
 */
export declare class MockUIAdapter implements UIAdapter {
    calls: {
        method: string;
        args: unknown[];
    }[];
    confirmResponse: boolean;
    inputResponse: string | undefined;
    quickPickResponse: string | string[] | undefined;
    showInfo(message: string, ...items: string[]): Promise<string | undefined>;
    showWarning(message: string, ...items: string[]): Promise<string | undefined>;
    showError(message: string, ...items: string[]): Promise<string | undefined>;
    promptInput(options: InputOptions): Promise<string | undefined>;
    promptQuickPick(items: QuickPickItem[], options?: QuickPickOptions): Promise<string | string[] | undefined>;
    confirm(message: string, confirmLabel?: string, cancelLabel?: string): Promise<boolean>;
    withProgress<T>(options: ProgressOptions, task: (progress: ProgressReporter, token: CancellationToken) => Promise<T>): Promise<T>;
    setStatusMessage(message: string, timeout?: number): () => void;
    reset(): void;
}
/**
 * Mock TerminalAdapter for testing terminal operations.
 */
export declare class MockTerminalAdapter implements TerminalAdapter {
    calls: {
        method: string;
        args: unknown[];
    }[];
    terminals: Map<string, TerminalHandle & {
        alive: boolean;
        sentText: string[];
    }>;
    closeCallbacks: Set<TerminalCloseCallback>;
    private nextId;
    createTerminal(options: CreateTerminalOptions): TerminalHandle;
    sendText(terminal: TerminalHandle, text: string, addNewline?: boolean): void;
    dispose(terminal: TerminalHandle): void;
    findByName(name: string): TerminalHandle | undefined;
    isAlive(terminal: TerminalHandle): boolean;
    show(terminal: TerminalHandle, preserveFocus?: boolean): void;
    getAll(): TerminalHandle[];
    onDidClose(callback: TerminalCloseCallback): () => void;
    reset(): void;
}
//# sourceMappingURL=mockAdapters.d.ts.map