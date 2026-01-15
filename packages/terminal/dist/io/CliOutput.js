/**
 * CliOutput - Terminal CLI output handler
 *
 * USAGE RESTRICTIONS:
 * This module is ONLY for use in the terminal CLI package (packages/terminal)
 * for non-interactive commands that run and exit BEFORE the Ink TUI starts.
 *
 * Valid uses:
 * - `opus-orchestra --help` / `--version`
 * - `opus-orchestra status`
 * - `opus-orchestra agents list/create/delete/focus`
 * - `opus-orchestra config show/set`
 *
 * INVALID uses (use Pino logger with LogStream instead):
 * - Anything inside the Ink dashboard TUI
 * - Any code in the VS Code extension (packages/vscode)
 * - Any code in core (packages/core)
 * - Debug/trace logging (use Pino logger)
 *
 * This is the ONLY file in the repository where console.* is permitted.
 * DO NOT use console.* anywhere else - use the Pino logger instead.
 */
/**
 * Output streams that can be redirected for testing.
 */
let stdout = (msg) => console.log(msg);
let stderr = (msg) => console.error(msg);
/**
 * Write a line to stdout (user-facing output).
 */
export function output(...args) {
    stdout(args.map(String).join(' '));
}
/**
 * Write a line to stderr (error output).
 */
export function outputError(...args) {
    stderr(args.map(String).join(' '));
}
/**
 * Clear the terminal screen.
 */
export function clearScreen() {
    console.clear();
}
/**
 * Capture output for testing purposes.
 * Returns a function to restore original output.
 */
export function captureOutput(onStdout, onStderr) {
    const originalStdout = stdout;
    const originalStderr = stderr;
    stdout = onStdout;
    stderr = onStderr;
    return () => {
        stdout = originalStdout;
        stderr = originalStderr;
    };
}
//# sourceMappingURL=CliOutput.js.map