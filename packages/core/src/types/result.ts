/**
 * Result Type - Explicit error handling without exceptions
 *
 * Use this for operations that can fail in expected ways.
 * The caller can distinguish between "no data" and "error getting data".
 *
 * Pattern:
 * - Success: { success: true, data: T }
 * - Failure: { success: false, error: string, code?: string }
 */

/**
 * Successful result with data
 */
export interface Success<T> {
  success: true;
  data: T;
}

/**
 * Failed result with error info
 */
export interface Failure {
  success: false;
  error: string;
  code?: string;
}

/**
 * Result type - either success with data or failure with error
 */
export type Result<T> = Success<T> | Failure;

/**
 * Create a success result
 */
export function ok<T>(data: T): Success<T> {
  return { success: true, data };
}

/**
 * Create a failure result
 */
export function err(error: string, code?: string): Failure {
  return { success: false, error, code };
}

/**
 * Check if a result is successful
 */
export function isOk<T>(result: Result<T>): result is Success<T> {
  return result.success;
}

/**
 * Check if a result is a failure
 */
export function isErr<T>(result: Result<T>): result is Failure {
  return !result.success;
}

/**
 * Unwrap a result, throwing if it's an error
 */
export function unwrap<T>(result: Result<T>): T {
  if (result.success) {
    return result.data;
  }
  throw new Error(result.error);
}

/**
 * Unwrap a result with a default value for errors
 */
export function unwrapOr<T>(result: Result<T>, defaultValue: T): T {
  if (result.success) {
    return result.data;
  }
  return defaultValue;
}

/**
 * Map a successful result to a new value
 */
export function map<T, U>(result: Result<T>, fn: (data: T) => U): Result<U> {
  if (result.success) {
    return ok(fn(result.data));
  }
  return result;
}

/**
 * Common error codes for git operations
 */
export const GitErrorCode = {
  TIMEOUT: 'GIT_TIMEOUT',
  NOT_A_REPO: 'GIT_NOT_A_REPO',
  COMMAND_FAILED: 'GIT_COMMAND_FAILED',
  BRANCH_NOT_FOUND: 'GIT_BRANCH_NOT_FOUND',
} as const;

/**
 * Common error codes for file operations
 */
export const FileErrorCode = {
  NOT_FOUND: 'FILE_NOT_FOUND',
  PERMISSION_DENIED: 'FILE_PERMISSION_DENIED',
  PARSE_ERROR: 'FILE_PARSE_ERROR',
  WRITE_ERROR: 'FILE_WRITE_ERROR',
} as const;
