/**
 * Print utilities for intentional user-facing output
 *
 * Use these instead of console.log when you WANT to print to stdout/stderr.
 * console.log is overridden to go to the logger, so use print() for CLI output.
 */

// Capture handlers for testing
let _captureStdout: ((s: string) => void) | null = null;
let _captureStderr: ((s: string) => void) | null = null;

/**
 * Print to stdout (like console.log but explicit)
 */
export function print(...args: unknown[]): void {
  const str = args.map(String).join(' ') + '\n';
  if (_captureStdout) {
    _captureStdout(str);
  } else {
    process.stdout.write(str);
  }
}

/**
 * Print to stderr (like console.error but explicit)
 */
export function printError(...args: unknown[]): void {
  const str = args.map(String).join(' ') + '\n';
  if (_captureStderr) {
    _captureStderr(str);
  } else {
    process.stderr.write(str);
  }
}

/**
 * Print to stdout without trailing newline
 */
export function printRaw(...args: unknown[]): void {
  const str = args.map(String).join(' ');
  if (_captureStdout) {
    _captureStdout(str);
  } else {
    process.stdout.write(str);
  }
}

/**
 * Clear the terminal (like console.clear but explicit)
 */
export function clearScreen(): void {
  if (!_captureStdout) {
    process.stdout.write('\x1Bc');
  }
}

/**
 * Capture print output for testing.
 * Returns a restore function.
 */
export function capturePrintOutput(
  onStdout: (s: string) => void,
  onStderr: (s: string) => void
): () => void {
  _captureStdout = onStdout;
  _captureStderr = onStderr;
  return () => {
    _captureStdout = null;
    _captureStderr = null;
  };
}
