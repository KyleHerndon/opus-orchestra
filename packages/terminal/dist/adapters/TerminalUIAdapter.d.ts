/**
 * TerminalUIAdapter - Terminal-based UI implementation
 *
 * Implements UIAdapter using:
 * - chalk for colored console output
 * - readline for basic prompts
 * - ora for spinners (progress indication)
 *
 * Note: For interactive Ink-based prompts during the dashboard,
 * we use Ink components directly. This adapter is for non-interactive
 * CLI commands and background operations.
 */
import type { UIAdapter, QuickPickItem, QuickPickOptions, InputOptions, ProgressOptions, ProgressReporter, CancellationToken } from '@opus-orchestra/core';
export declare class TerminalUIAdapter implements UIAdapter {
    /**
     * Show an information message.
     */
    showInfo(message: string, ...items: string[]): Promise<string | undefined>;
    /**
     * Show a warning message.
     */
    showWarning(message: string, ...items: string[]): Promise<string | undefined>;
    /**
     * Show an error message.
     */
    showError(message: string, ...items: string[]): Promise<string | undefined>;
    /**
     * Prompt for text input.
     */
    promptInput(options: InputOptions): Promise<string | undefined>;
    /**
     * Show a quick pick selection dialog.
     */
    promptQuickPick(items: QuickPickItem[], options?: QuickPickOptions): Promise<string | string[] | undefined>;
    /**
     * Show a confirmation dialog.
     */
    confirm(message: string, confirmLabel?: string, cancelLabel?: string): Promise<boolean>;
    /**
     * Run an operation with progress indication.
     */
    withProgress<T>(options: ProgressOptions, task: (progress: ProgressReporter, token: CancellationToken) => Promise<T>): Promise<T>;
    /**
     * Set status bar message (no-op for terminal, could use bottom bar).
     */
    setStatusMessage(message: string, _timeout?: number): () => void;
    /**
     * Helper: prompt for selection from string array.
     */
    private promptSelect;
}
//# sourceMappingURL=TerminalUIAdapter.d.ts.map