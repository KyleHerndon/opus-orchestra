/**
 * TmuxTerminalAdapter - Terminal adapter using tmux sessions
 *
 * For the terminal package, we primarily manage terminals via tmux.
 * - `createTerminal` creates or attaches to a tmux session
 * - `show` attaches to the tmux session (exits the TUI)
 * - Agent terminals are persistent tmux sessions
 */
import { spawn } from 'node:child_process';
import { createNullLogger } from '@opus-orchestra/core';
export class TmuxTerminalAdapter {
    system;
    tmuxService;
    terminals = new Map();
    closeCallbacks = new Set();
    nextId = 1;
    logger;
    constructor(system, tmuxService, logger) {
        this.system = system;
        this.tmuxService = tmuxService;
        this.logger = logger?.child({ component: 'TmuxTerminalAdapter' }) ?? createNullLogger();
    }
    createTerminal(options) {
        const id = `terminal-${this.nextId++}`;
        // Use sessionId-based naming when available for stability across renames
        // Falls back to sanitized name for backwards compatibility
        const sessionName = options.sessionId && this.tmuxService
            ? this.tmuxService.getSessionName(options.sessionId)
            : options.name.replace(/[^a-zA-Z0-9-]/g, '-');
        const terminal = {
            id,
            name: options.name,
            sessionName,
            cwd: options.cwd,
            alive: true,
        };
        this.terminals.set(id, terminal);
        // Create tmux session in background (don't attach)
        const cwd = options.cwd || process.cwd();
        this.system.exec(`tmux new-session -d -s "${sessionName}" -c "${cwd}"`, cwd).catch((err) => {
            // Session might already exist - this is expected and OK
            // Log at debug level since this is a common case
            this.logger.debug({ err: err instanceof Error ? err.message : String(err) }, `Session creation returned error (may already exist): ${sessionName}`);
        });
        return terminal;
    }
    sendText(terminal, text, addNewline = true) {
        const t = this.terminals.get(terminal.id);
        if (!t || !t.alive) {
            return;
        }
        const escapedText = text.replace(/"/g, '\\"');
        const cmd = addNewline
            ? `tmux send-keys -t "${t.sessionName}" "${escapedText}" Enter`
            : `tmux send-keys -t "${t.sessionName}" "${escapedText}"`;
        this.system.exec(cmd, process.cwd()).catch((err) => {
            // Log at warn level - this is a real error, but we can't do much about it
            this.logger.warn({ err: err instanceof Error ? err : new Error(String(err)) }, `Failed to send text to tmux session ${t.sessionName}`);
        });
    }
    dispose(terminal) {
        const t = this.terminals.get(terminal.id);
        if (!t) {
            return;
        }
        t.alive = false;
        // Kill tmux session
        this.system.exec(`tmux kill-session -t "${t.sessionName}"`, process.cwd()).catch((err) => {
            // Session might not exist - expected during cleanup
            this.logger.debug({ err: err instanceof Error ? err.message : String(err) }, `Session kill returned error (may not exist): ${t.sessionName}`);
        });
        this.terminals.delete(terminal.id);
        // Notify listeners - catch errors so one bad listener doesn't break others
        for (const callback of this.closeCallbacks) {
            try {
                callback(terminal);
            }
            catch (err) {
                this.logger.error({ err: err instanceof Error ? err : new Error(String(err)) }, 'Terminal close callback error');
            }
        }
    }
    findByName(name) {
        for (const terminal of this.terminals.values()) {
            if (terminal.name === name) {
                return terminal;
            }
        }
        return undefined;
    }
    isAlive(terminal) {
        const t = this.terminals.get(terminal.id);
        return t?.alive ?? false;
    }
    /**
     * Show/focus a terminal by attaching to its tmux session.
     *
     * NOTE: This will exit the TUI and attach to tmux in the current terminal.
     * The user can return to the TUI by detaching from tmux (Ctrl+B, D) and
     * running `opus` again.
     */
    show(terminal, _preserveFocus) {
        const t = this.terminals.get(terminal.id);
        if (!t || !t.alive) {
            return;
        }
        // Spawn tmux attach in the foreground
        // This takes over the terminal, exiting the TUI
        const child = spawn('tmux', ['attach-session', '-t', t.sessionName], {
            stdio: 'inherit',
        });
        child.on('error', (err) => {
            // Spawn itself failed (e.g., tmux not found)
            this.logger.error({ err }, `Failed to spawn tmux attach for session ${t.sessionName}`);
        });
        child.on('exit', () => {
            // User detached from tmux, they can run `opus` again
        });
    }
    getAll() {
        return Array.from(this.terminals.values()).filter((t) => t.alive);
    }
    onDidClose(callback) {
        this.closeCallbacks.add(callback);
        return () => {
            this.closeCallbacks.delete(callback);
        };
    }
    /**
     * Check if a tmux session exists.
     */
    async sessionExists(sessionName) {
        try {
            await this.system.exec(`tmux has-session -t "${sessionName}"`, process.cwd());
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Attach to an existing tmux session.
     * This exits the TUI and takes over the terminal.
     */
    attachSession(sessionName) {
        const child = spawn('tmux', ['attach-session', '-t', sessionName], {
            stdio: 'inherit',
        });
        child.on('error', (err) => {
            // Spawn itself failed (e.g., tmux not found)
            this.logger.error({ err }, `Failed to spawn tmux attach for session ${sessionName}`);
        });
        child.on('exit', () => {
            // User detached from tmux
        });
    }
}
//# sourceMappingURL=TmuxTerminalAdapter.js.map