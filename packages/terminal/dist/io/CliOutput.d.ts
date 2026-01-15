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
 * Write a line to stdout (user-facing output).
 */
export declare function output(...args: unknown[]): void;
/**
 * Write a line to stderr (error output).
 */
export declare function outputError(...args: unknown[]): void;
/**
 * Clear the terminal screen.
 */
export declare function clearScreen(): void;
/**
 * Capture output for testing purposes.
 * Returns a function to restore original output.
 */
export declare function captureOutput(onStdout: (msg: string) => void, onStderr: (msg: string) => void): () => void;
//# sourceMappingURL=CliOutput.d.ts.map