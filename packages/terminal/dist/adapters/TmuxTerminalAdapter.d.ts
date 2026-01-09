/**
 * TmuxTerminalAdapter - Terminal adapter using tmux sessions
 *
 * For the terminal package, we primarily manage terminals via tmux.
 * - `createTerminal` creates or attaches to a tmux session
 * - `show` attaches to the tmux session (exits the TUI)
 * - Agent terminals are persistent tmux sessions
 */
import type { TerminalAdapter, TerminalHandle, CreateTerminalOptions, TerminalCloseCallback, SystemAdapter } from '@opus-orchestra/core';
export declare class TmuxTerminalAdapter implements TerminalAdapter {
    private system;
    private terminals;
    private closeCallbacks;
    private nextId;
    constructor(system: SystemAdapter);
    createTerminal(options: CreateTerminalOptions): TerminalHandle;
    sendText(terminal: TerminalHandle, text: string, addNewline?: boolean): void;
    dispose(terminal: TerminalHandle): void;
    findByName(name: string): TerminalHandle | undefined;
    isAlive(terminal: TerminalHandle): boolean;
    /**
     * Show/focus a terminal by attaching to its tmux session.
     *
     * NOTE: This will exit the TUI and attach to tmux in the current terminal.
     * The user can return to the TUI by detaching from tmux (Ctrl+B, D) and
     * running `opus` again.
     */
    show(terminal: TerminalHandle, _preserveFocus?: boolean): void;
    getAll(): TerminalHandle[];
    onDidClose(callback: TerminalCloseCallback): () => void;
    /**
     * Check if a tmux session exists.
     */
    sessionExists(sessionName: string): Promise<boolean>;
    /**
     * Attach to an existing tmux session.
     * This exits the TUI and takes over the terminal.
     */
    attachSession(sessionName: string): void;
}
//# sourceMappingURL=TmuxTerminalAdapter.d.ts.map