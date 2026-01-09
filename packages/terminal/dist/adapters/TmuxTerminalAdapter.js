/**
 * TmuxTerminalAdapter - Terminal adapter using tmux sessions
 *
 * For the terminal package, we primarily manage terminals via tmux.
 * - `createTerminal` creates or attaches to a tmux session
 * - `show` attaches to the tmux session (exits the TUI)
 * - Agent terminals are persistent tmux sessions
 */
import { spawn } from 'node:child_process';
export class TmuxTerminalAdapter {
    system;
    terminals = new Map();
    closeCallbacks = new Set();
    nextId = 1;
    constructor(system) {
        this.system = system;
    }
    createTerminal(options) {
        const id = `terminal-${this.nextId++}`;
        const sessionName = options.name.replace(/[^a-zA-Z0-9-]/g, '-');
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
        this.system.exec(`tmux new-session -d -s "${sessionName}" -c "${cwd}"`, cwd).catch(() => {
            // Session might already exist, that's OK
        });
        return terminal;
    }
    sendText(terminal, text, addNewline = true) {
        const t = this.terminals.get(terminal.id);
        if (!t || !t.alive)
            return;
        const escapedText = text.replace(/"/g, '\\"');
        const cmd = addNewline
            ? `tmux send-keys -t "${t.sessionName}" "${escapedText}" Enter`
            : `tmux send-keys -t "${t.sessionName}" "${escapedText}"`;
        this.system.exec(cmd, process.cwd()).catch((err) => {
            console.error(`Failed to send text to tmux session ${t.sessionName}:`, err);
        });
    }
    dispose(terminal) {
        const t = this.terminals.get(terminal.id);
        if (!t)
            return;
        t.alive = false;
        // Kill tmux session
        this.system.exec(`tmux kill-session -t "${t.sessionName}"`, process.cwd()).catch(() => {
            // Session might not exist
        });
        this.terminals.delete(terminal.id);
        // Notify listeners
        for (const callback of this.closeCallbacks) {
            try {
                callback(terminal);
            }
            catch (err) {
                console.error('Terminal close callback error:', err);
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
        if (!t || !t.alive)
            return;
        // Spawn tmux attach in the foreground
        // This takes over the terminal, exiting the TUI
        const child = spawn('tmux', ['attach-session', '-t', t.sessionName], {
            stdio: 'inherit',
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
        child.on('exit', () => {
            // User detached from tmux
        });
    }
}
//# sourceMappingURL=TmuxTerminalAdapter.js.map