/**
 * Timeout utilities for long-running operations
 *
 * Provides:
 * - Promise timeout wrapper with progress callbacks
 * - Integration with UIAdapter.withProgress()
 * - Cancellation support via AbortSignal
 */

/**
 * Options for timeout wrapper
 */
export interface TimeoutOptions {
  /** Timeout in milliseconds */
  timeout: number;
  /** Operation name for error messages */
  operationName: string;
  /** Optional progress callback */
  onProgress?: (message: string, percent?: number) => void;
  /** Optional abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Result of a timed operation
 */
export interface TimeoutResult<T> {
  /** The operation result */
  result: T;
  /** Time elapsed in milliseconds */
  elapsed: number;
}

/**
 * Error thrown when operation times out
 */
export class TimeoutError extends Error {
  readonly code = 'TIMEOUT';
  readonly operationName: string;
  readonly timeout: number;

  constructor(operationName: string, timeout: number) {
    super(`Operation '${operationName}' timed out after ${timeout}ms`);
    this.name = 'TimeoutError';
    this.operationName = operationName;
    this.timeout = timeout;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Error thrown when operation is cancelled
 */
export class CancelledError extends Error {
  readonly code = 'CANCELLED';
  readonly operationName: string;

  constructor(operationName: string) {
    super(`Operation '${operationName}' was cancelled`);
    this.name = 'CancelledError';
    this.operationName = operationName;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Wrap a promise with timeout and progress reporting
 *
 * @example
 * ```typescript
 * const result = await withTimeout(
 *   gitService.getDiffStats(path, branch),
 *   {
 *     timeout: 10000,
 *     operationName: 'getDiffStats',
 *     onProgress: (msg) => console.log(msg),
 *   }
 * );
 * ```
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  options: TimeoutOptions
): Promise<TimeoutResult<T>> {
  const { timeout, operationName, onProgress, signal } = options;
  const startTime = Date.now();

  // Check if already aborted
  if (signal?.aborted) {
    throw new CancelledError(operationName);
  }

  // Report start
  onProgress?.(`Starting ${operationName}...`, 0);

  return new Promise<TimeoutResult<T>>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    // Set up abort listener
    const abortHandler = (): void => {
      if (!settled) {
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        reject(new CancelledError(operationName));
      }
    };
    signal?.addEventListener('abort', abortHandler, { once: true });

    // Set up timeout
    timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        signal?.removeEventListener('abort', abortHandler);
        reject(new TimeoutError(operationName, timeout));
      }
    }, timeout);

    // Run the operation
    promise
      .then((result) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          signal?.removeEventListener('abort', abortHandler);
          const elapsed = Date.now() - startTime;
          onProgress?.(`Completed ${operationName}`, 100);
          resolve({ result, elapsed });
        }
      })
      .catch((error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          signal?.removeEventListener('abort', abortHandler);
          reject(error);
        }
      });
  });
}

/**
 * Simple timeout wrapper without progress tracking
 */
export async function withSimpleTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  operationName = 'operation'
): Promise<T> {
  const { result } = await withTimeout(promise, { timeout, operationName });
  return result;
}

/**
 * Create a delay promise (useful for testing and retry logic)
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Race multiple promises, returning the first to complete
 * with timeout safety
 */
export async function raceWithTimeout<T>(
  promises: Promise<T>[],
  timeout: number,
  operationName = 'race'
): Promise<T> {
  return withSimpleTimeout(Promise.race(promises), timeout, operationName);
}
