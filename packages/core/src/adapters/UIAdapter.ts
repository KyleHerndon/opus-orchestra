/**
 * UIAdapter - Abstracts user interface operations
 *
 * This interface allows core logic to interact with users without
 * depending on VS Code's UI APIs.
 *
 * Implementations:
 * - VSCodeUIAdapter (packages/vscode) - VS Code dialogs and notifications
 * - TerminalUIAdapter - CLI prompts
 * - WebUIAdapter - Browser-based UI
 * - MockUIAdapter (tests) - For unit testing
 */

/**
 * Quick pick item for selection dialogs
 */
export interface QuickPickItem {
  /** Display text */
  label: string;

  /** Secondary text (smaller, dimmed) */
  description?: string;

  /** Additional detail text */
  detail?: string;

  /** Value returned when selected */
  value: string;

  /** Whether this item is picked by default */
  picked?: boolean;
}

/**
 * Options for input prompts
 */
export interface InputOptions {
  /** Prompt text shown above input */
  prompt: string;

  /** Initial value */
  value?: string;

  /** Placeholder text */
  placeholder?: string;

  /** Title for the input dialog */
  title?: string;

  /**
   * Validation function.
   * @param value - Current input value
   * @returns Error message if invalid, null/undefined if valid
   */
  validateInput?: (value: string) => string | null | undefined;
}

/**
 * Options for quick pick dialogs
 */
export interface QuickPickOptions {
  /** Title for the picker */
  title?: string;

  /** Placeholder text shown when empty */
  placeholder?: string;

  /** Allow selecting multiple items */
  canPickMany?: boolean;

  /** Match on description in addition to label */
  matchOnDescription?: boolean;
}

/**
 * Progress options
 */
export interface ProgressOptions {
  /** Title shown during progress */
  title: string;

  /** Whether the operation can be cancelled */
  cancellable?: boolean;

  /** Location hint for progress display */
  location?: 'notification' | 'statusbar' | 'window';
}

/**
 * Progress reporter for long-running operations
 */
export interface ProgressReporter {
  /**
   * Report progress update.
   *
   * @param options - Progress update options
   */
  report(options: { message?: string; increment?: number }): void;
}

/**
 * Cancellation token for async operations
 */
export interface CancellationToken {
  /** Whether cancellation has been requested */
  isCancellationRequested: boolean;

  /**
   * Subscribe to cancellation events.
   *
   * @param callback - Function to call when cancelled
   * @returns Unsubscribe function
   */
  onCancellationRequested(callback: () => void): () => void;
}

/**
 * UIAdapter abstracts all user interface operations.
 */
export interface UIAdapter {
  // ========== Messages ==========

  /**
   * Show an information message.
   *
   * @param message - Message to display
   * @param items - Optional action buttons
   * @returns Selected item label, or undefined if dismissed
   */
  showInfo(message: string, ...items: string[]): Promise<string | undefined>;

  /**
   * Show a warning message.
   *
   * @param message - Message to display
   * @param items - Optional action buttons
   * @returns Selected item label, or undefined if dismissed
   */
  showWarning(message: string, ...items: string[]): Promise<string | undefined>;

  /**
   * Show an error message.
   *
   * @param message - Message to display
   * @param items - Optional action buttons
   * @returns Selected item label, or undefined if dismissed
   */
  showError(message: string, ...items: string[]): Promise<string | undefined>;

  // ========== Input ==========

  /**
   * Prompt for text input.
   *
   * @param options - Input options
   * @returns User input, or undefined if cancelled
   */
  promptInput(options: InputOptions): Promise<string | undefined>;

  /**
   * Show a quick pick selection dialog.
   *
   * @param items - Items to choose from
   * @param options - Dialog options
   * @returns Selected item value(s), or undefined if cancelled
   */
  promptQuickPick(
    items: QuickPickItem[],
    options?: QuickPickOptions
  ): Promise<string | string[] | undefined>;

  /**
   * Show a confirmation dialog.
   *
   * @param message - Question to ask
   * @param confirmLabel - Label for confirm button (default: "Yes")
   * @param cancelLabel - Label for cancel button (default: "No")
   * @returns true if confirmed, false otherwise
   */
  confirm(
    message: string,
    confirmLabel?: string,
    cancelLabel?: string
  ): Promise<boolean>;

  // ========== Progress ==========

  /**
   * Run an operation with progress indication.
   *
   * @param options - Progress options
   * @param task - Async function to run
   * @returns Result of the task
   */
  withProgress<T>(
    options: ProgressOptions,
    task: (
      progress: ProgressReporter,
      token: CancellationToken
    ) => Promise<T>
  ): Promise<T>;

  // ========== Status ==========

  /**
   * Set status bar message (if supported).
   *
   * @param message - Message to show
   * @param timeout - Auto-hide after ms (0 = persistent)
   * @returns Function to clear the status
   */
  setStatusMessage?(message: string, timeout?: number): () => void;
}
