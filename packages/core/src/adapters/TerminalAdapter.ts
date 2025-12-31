/**
 * TerminalAdapter - Abstracts terminal creation and management
 *
 * This interface allows core logic to manage terminals without
 * depending on VS Code's terminal API.
 *
 * Implementations:
 * - VSCodeTerminalAdapter (packages/vscode) - VS Code terminal integration
 * - MockTerminalAdapter (tests) - For unit testing
 */

/**
 * Terminal handle - opaque reference to a terminal instance.
 * The actual implementation is adapter-specific.
 */
export interface TerminalHandle {
  /** Unique identifier for this terminal */
  readonly id: string;

  /** Display name of the terminal */
  readonly name: string;
}

/**
 * Options for creating a terminal
 */
export interface CreateTerminalOptions {
  /** Display name for the terminal */
  name: string;

  /** Working directory */
  cwd?: string;

  /** Environment variables to set */
  env?: Record<string, string>;

  /** Path to shell executable */
  shellPath?: string;

  /** Arguments to pass to shell */
  shellArgs?: string[];

  /** Icon identifier (implementation-specific) */
  iconId?: string;
}

/**
 * Callback for terminal events
 */
export type TerminalCloseCallback = (terminal: TerminalHandle) => void;

/**
 * TerminalAdapter abstracts terminal creation and management.
 */
export interface TerminalAdapter {
  /**
   * Create a new terminal.
   *
   * @param options - Terminal creation options
   * @returns Handle to the created terminal
   */
  createTerminal(options: CreateTerminalOptions): TerminalHandle;

  /**
   * Send text to a terminal.
   * The text is typically followed by a newline.
   *
   * @param terminal - Terminal handle
   * @param text - Text to send
   * @param addNewline - Whether to add a newline (default: true)
   */
  sendText(terminal: TerminalHandle, text: string, addNewline?: boolean): void;

  /**
   * Close/dispose a terminal.
   *
   * @param terminal - Terminal handle
   */
  dispose(terminal: TerminalHandle): void;

  /**
   * Find a terminal by name.
   *
   * @param name - Terminal name to search for
   * @returns Terminal handle if found, undefined otherwise
   */
  findByName(name: string): TerminalHandle | undefined;

  /**
   * Check if a terminal is still alive/open.
   *
   * @param terminal - Terminal handle
   * @returns true if terminal is still open
   */
  isAlive(terminal: TerminalHandle): boolean;

  /**
   * Show/focus a terminal.
   *
   * @param terminal - Terminal handle
   * @param preserveFocus - If true, don't move focus to terminal
   */
  show(terminal: TerminalHandle, preserveFocus?: boolean): void;

  /**
   * Get all active terminals.
   *
   * @returns Array of terminal handles
   */
  getAll(): TerminalHandle[];

  /**
   * Subscribe to terminal close events.
   *
   * @param callback - Function to call when a terminal closes
   * @returns Unsubscribe function
   */
  onDidClose(callback: TerminalCloseCallback): () => void;

  /**
   * Subscribe to terminal open events.
   *
   * @param callback - Function to call when a terminal opens
   * @returns Unsubscribe function
   */
  onDidOpen?(callback: (terminal: TerminalHandle) => void): () => void;
}
