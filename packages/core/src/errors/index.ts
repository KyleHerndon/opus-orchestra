/**
 * Custom error classes for structured error handling
 *
 * Each error includes:
 * - Descriptive name for logging
 * - Error code for programmatic handling
 * - Context information for debugging
 * - Recoverable flag indicating if retry/recovery is possible
 */

// ============================================================================
// Base Error
// ============================================================================

/**
 * Base error class for all Opus Orchestra errors
 */
export abstract class OpusError extends Error {
  /** Error code for programmatic handling */
  abstract readonly code: string;
  /** Whether this error can potentially be recovered from */
  abstract readonly recoverable: boolean;
  /** Additional context for debugging */
  readonly context?: Record<string, unknown>;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * Serialize error for logging or transmission
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      context: this.context,
      stack: this.stack,
    };
  }
}

// ============================================================================
// Agent Errors
// ============================================================================

/**
 * Agent not found in the system
 */
export class AgentNotFoundError extends OpusError {
  readonly code = 'AGENT_NOT_FOUND';
  readonly recoverable = false;

  constructor(agentId: number) {
    super(`Agent ${agentId} not found`, { agentId });
  }
}

/**
 * Invalid agent state for requested operation
 */
export class AgentStateError extends OpusError {
  readonly code = 'AGENT_STATE_ERROR';
  readonly recoverable = true;

  constructor(agentId: number, currentState: string, attemptedAction: string) {
    super(
      `Cannot ${attemptedAction} agent ${agentId} in state '${currentState}'`,
      { agentId, currentState, attemptedAction }
    );
  }
}

/**
 * Agent metadata is invalid or corrupted
 */
export class AgentMetadataError extends OpusError {
  readonly code = 'AGENT_METADATA_ERROR';
  readonly recoverable = true;

  constructor(worktreePath: string, reason: string) {
    super(`Invalid agent metadata at ${worktreePath}: ${reason}`, {
      worktreePath,
      reason,
    });
  }
}

// ============================================================================
// Terminal/Session Errors
// ============================================================================

/**
 * Terminal session operation failed
 */
export class SessionError extends OpusError {
  readonly code = 'SESSION_ERROR';
  readonly recoverable = true;

  constructor(sessionName: string, operation: string, cause?: Error) {
    super(
      `Session '${sessionName}' ${operation} failed: ${cause?.message || 'Unknown error'}`,
      { sessionName, operation, cause: cause?.message }
    );
  }
}

/**
 * tmux is not available on the system
 */
export class TmuxNotAvailableError extends OpusError {
  readonly code = 'TMUX_NOT_AVAILABLE';
  readonly recoverable = false;

  constructor() {
    super(
      'tmux is not available on this system. Please install tmux to use terminal features.'
    );
  }
}

/**
 * Terminal already exists
 */
export class TerminalExistsError extends OpusError {
  readonly code = 'TERMINAL_EXISTS';
  readonly recoverable = true;

  constructor(terminalId: number) {
    super(`Terminal ${terminalId} already exists`, { terminalId });
  }
}

// ============================================================================
// Container Errors
// ============================================================================

/**
 * Container operation failed
 */
export class ContainerError extends OpusError {
  readonly code = 'CONTAINER_ERROR';
  readonly recoverable = true;

  constructor(containerId: string, operation: string, cause?: Error) {
    super(
      `Container '${containerId}' ${operation} failed: ${cause?.message || 'Unknown error'}`,
      { containerId, operation, cause: cause?.message }
    );
  }
}

/**
 * Container not found for agent
 */
export class ContainerNotFoundError extends OpusError {
  readonly code = 'CONTAINER_NOT_FOUND';
  readonly recoverable = false;

  constructor(agentId: number) {
    super(`No container found for agent ${agentId}`, { agentId });
  }
}

/**
 * Container configuration not found
 */
export class ContainerConfigError extends OpusError {
  readonly code = 'CONTAINER_CONFIG_ERROR';
  readonly recoverable = false;

  constructor(configName: string, reason: string) {
    super(`Container config '${configName}' error: ${reason}`, {
      configName,
      reason,
    });
  }
}

// ============================================================================
// Git/Worktree Errors
// ============================================================================

/**
 * Worktree operation failed
 */
export class WorktreeError extends OpusError {
  readonly code = 'WORKTREE_ERROR';
  readonly recoverable = true;

  constructor(path: string, operation: string, cause?: Error) {
    super(
      `Worktree at '${path}' ${operation} failed: ${cause?.message || 'Unknown error'}`,
      { path, operation, cause: cause?.message }
    );
  }
}

/**
 * Git operation failed
 */
export class GitOperationError extends OpusError {
  readonly code = 'GIT_OPERATION_ERROR';
  readonly recoverable = true;

  constructor(operation: string, path: string, cause?: Error) {
    super(
      `Git ${operation} failed in '${path}': ${cause?.message || 'Unknown error'}`,
      { operation, path, cause: cause?.message }
    );
  }
}

/**
 * Branch already exists
 */
export class BranchExistsError extends OpusError {
  readonly code = 'BRANCH_EXISTS';
  readonly recoverable = false;

  constructor(branchName: string, repoPath: string) {
    super(`Branch '${branchName}' already exists in ${repoPath}`, {
      branchName,
      repoPath,
    });
  }
}

// ============================================================================
// Configuration Errors
// ============================================================================

/**
 * Configuration value is invalid
 */
export class ConfigurationError extends OpusError {
  readonly code = 'CONFIG_ERROR';
  readonly recoverable = true;

  constructor(key: string, reason: string) {
    super(`Configuration error for '${key}': ${reason}`, { key, reason });
  }
}

/**
 * Validation failed for an entity
 */
export class ValidationError extends OpusError {
  readonly code = 'VALIDATION_ERROR';
  readonly recoverable = false;

  constructor(
    entity: string,
    field: string,
    value: unknown,
    reason: string
  ) {
    super(`Validation failed for ${entity}.${field}: ${reason}`, {
      entity,
      field,
      value,
      reason,
    });
  }
}

// ============================================================================
// Polling/State Errors
// ============================================================================

/**
 * Polling operation failed
 */
export class PollingError extends OpusError {
  readonly code = 'POLLING_ERROR';
  readonly recoverable = true;

  constructor(operation: string, cause?: Error) {
    super(
      `Polling ${operation} failed: ${cause?.message || 'Unknown error'}`,
      { operation, cause: cause?.message }
    );
  }
}

/**
 * Operation was cancelled
 */
export class CancellationError extends OpusError {
  readonly code = 'CANCELLED';
  readonly recoverable = false;

  constructor(operation: string) {
    super(`Operation '${operation}' was cancelled`, { operation });
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if an error is an OpusError
 */
export function isOpusError(error: unknown): error is OpusError {
  return error instanceof OpusError;
}

/**
 * Check if an error is recoverable
 */
export function isRecoverableError(error: unknown): boolean {
  if (isOpusError(error)) {
    return error.recoverable;
  }
  return false;
}

/**
 * Wrap an unknown error as an OpusError
 */
export function wrapError(
  error: unknown,
  context: string
): OpusError {
  if (isOpusError(error)) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);

  // Create a generic wrapped error
  class WrappedError extends OpusError {
    readonly code = 'WRAPPED_ERROR';
    readonly recoverable = false;
  }

  return new WrappedError(`${context}: ${message}`, {
    originalError: message,
    context,
  });
}
