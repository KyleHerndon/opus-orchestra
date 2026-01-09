/**
 * Mock adapters for testing
 */
/**
 * Mock SystemAdapter that records calls and returns configurable responses.
 */
export class MockSystemAdapter {
    calls = [];
    execResponses = new Map();
    execErrors = new Map();
    terminalType = 'system';
    async exec(command, cwd) {
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
    spawn(command, args, options) {
        this.calls.push({ method: 'spawn', args: [command, args, options] });
        return {
            stdout: (async function* () {
                yield '';
            })(),
            exitCode: Promise.resolve(0),
        };
    }
    fileExists(path) {
        this.calls.push({ method: 'fileExists', args: [path] });
        return false;
    }
    directoryExists(path) {
        this.calls.push({ method: 'directoryExists', args: [path] });
        return false;
    }
    readFile(path) {
        this.calls.push({ method: 'readFile', args: [path] });
        return '';
    }
    writeFile(path, content) {
        this.calls.push({ method: 'writeFile', args: [path, content] });
    }
    createDirectory(path) {
        this.calls.push({ method: 'createDirectory', args: [path] });
    }
    deleteFile(path) {
        this.calls.push({ method: 'deleteFile', args: [path] });
    }
    deleteDirectory(path) {
        this.calls.push({ method: 'deleteDirectory', args: [path] });
    }
    listDirectory(path) {
        this.calls.push({ method: 'listDirectory', args: [path] });
        return [];
    }
    joinPath(...segments) {
        this.calls.push({ method: 'joinPath', args: segments });
        return segments.join('/');
    }
    resolvePath(path) {
        this.calls.push({ method: 'resolvePath', args: [path] });
        return path;
    }
    getParentPath(path) {
        this.calls.push({ method: 'getParentPath', args: [path] });
        const parts = path.split('/');
        parts.pop();
        return parts.join('/');
    }
    getBaseName(path) {
        this.calls.push({ method: 'getBaseName', args: [path] });
        return path.split('/').pop() || '';
    }
    reset() {
        this.calls = [];
        this.execResponses.clear();
        this.execErrors.clear();
    }
}
/**
 * Mock UIAdapter that records calls and can be configured with responses.
 */
export class MockUIAdapter {
    calls = [];
    confirmResponse = true;
    inputResponse = undefined;
    quickPickResponse = undefined;
    async showInfo(message, ...items) {
        this.calls.push({ method: 'showInfo', args: [message, ...items] });
        return items.length > 0 ? items[0] : undefined;
    }
    async showWarning(message, ...items) {
        this.calls.push({ method: 'showWarning', args: [message, ...items] });
        return items.length > 0 ? items[0] : undefined;
    }
    async showError(message, ...items) {
        this.calls.push({ method: 'showError', args: [message, ...items] });
        return items.length > 0 ? items[0] : undefined;
    }
    async promptInput(options) {
        this.calls.push({ method: 'promptInput', args: [options] });
        return this.inputResponse;
    }
    async promptQuickPick(items, options) {
        this.calls.push({ method: 'promptQuickPick', args: [items, options] });
        return this.quickPickResponse;
    }
    async confirm(message, confirmLabel, cancelLabel) {
        this.calls.push({ method: 'confirm', args: [message, confirmLabel, cancelLabel] });
        return this.confirmResponse;
    }
    async withProgress(options, task) {
        this.calls.push({ method: 'withProgress', args: [options] });
        const token = {
            isCancellationRequested: false,
            onCancellationRequested: () => () => { },
        };
        const progress = {
            report: () => { },
        };
        return task(progress, token);
    }
    setStatusMessage(message, timeout) {
        this.calls.push({ method: 'setStatusMessage', args: [message, timeout] });
        return () => { };
    }
    reset() {
        this.calls = [];
        this.confirmResponse = true;
        this.inputResponse = undefined;
        this.quickPickResponse = undefined;
    }
}
/**
 * Mock TerminalAdapter for testing terminal operations.
 */
export class MockTerminalAdapter {
    calls = [];
    terminals = new Map();
    closeCallbacks = new Set();
    nextId = 1;
    createTerminal(options) {
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
    sendText(terminal, text, addNewline) {
        this.calls.push({ method: 'sendText', args: [terminal, text, addNewline] });
        const t = this.terminals.get(terminal.id);
        if (t) {
            t.sentText.push(text);
        }
    }
    dispose(terminal) {
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
    findByName(name) {
        this.calls.push({ method: 'findByName', args: [name] });
        for (const terminal of this.terminals.values()) {
            if (terminal.name === name) {
                return terminal;
            }
        }
        return undefined;
    }
    isAlive(terminal) {
        this.calls.push({ method: 'isAlive', args: [terminal] });
        return this.terminals.get(terminal.id)?.alive ?? false;
    }
    show(terminal, preserveFocus) {
        this.calls.push({ method: 'show', args: [terminal, preserveFocus] });
    }
    getAll() {
        this.calls.push({ method: 'getAll', args: [] });
        return Array.from(this.terminals.values()).filter((t) => t.alive);
    }
    onDidClose(callback) {
        this.calls.push({ method: 'onDidClose', args: [] });
        this.closeCallbacks.add(callback);
        return () => {
            this.closeCallbacks.delete(callback);
        };
    }
    reset() {
        this.calls = [];
        this.terminals.clear();
        this.closeCallbacks.clear();
        this.nextId = 1;
    }
}
//# sourceMappingURL=mockAdapters.js.map