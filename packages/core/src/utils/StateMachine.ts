/**
 * StateMachine - Lightweight finite state machine
 *
 * Features:
 * - Type-safe states and transitions
 * - Validates transitions and rejects invalid ones
 * - Optional entry/exit actions
 * - Event emission for state changes
 */

/**
 * Transition configuration for a single event
 */
export interface TransitionConfig<S extends string> {
  /** State(s) from which this transition is allowed */
  from: S | S[];
  /** Target state after transition */
  to: S;
}

/**
 * Full state machine configuration
 */
export interface StateMachineConfig<S extends string, E extends string> {
  /** Initial state */
  initial: S;
  /** Transition definitions keyed by event */
  transitions: Record<E, TransitionConfig<S>>;
  /** Callback fired on successful transition */
  onTransition?: (from: S, to: S, event: E) => void;
  /** Callback fired when an invalid transition is attempted */
  onInvalidTransition?: (currentState: S, event: E, allowedFrom: S[]) => void;
}

/**
 * Error thrown when an invalid state transition is attempted
 */
export class InvalidTransitionError extends Error {
  constructor(
    public readonly currentState: string,
    public readonly event: string,
    public readonly allowedFromStates: string[]
  ) {
    super(
      `Invalid transition: Cannot apply '${event}' from state '${currentState}'. ` +
        `Allowed from: [${allowedFromStates.join(', ')}]`
    );
    this.name = 'InvalidTransitionError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Result of a tryTransition attempt
 */
export interface TransitionResult<S extends string> {
  success: boolean;
  state: S;
  error?: InvalidTransitionError;
}

/**
 * Lightweight finite state machine with type-safe transitions
 *
 * @example
 * ```typescript
 * const machine = new StateMachine({
 *   initial: 'idle',
 *   transitions: {
 *     START: { from: 'idle', to: 'working' },
 *     COMPLETE: { from: 'working', to: 'idle' },
 *     ERROR: { from: ['working', 'idle'], to: 'error' },
 *   },
 *   onTransition: (from, to, event) => {
 *     console.log(`${from} -> ${to} via ${event}`);
 *   },
 * });
 *
 * machine.transition('START'); // idle -> working
 * machine.canTransition('COMPLETE'); // true
 * machine.tryTransition('START'); // { success: false, state: 'working' }
 * ```
 */
export class StateMachine<S extends string, E extends string> {
  private _state: S;
  private readonly config: StateMachineConfig<S, E>;

  constructor(config: StateMachineConfig<S, E>) {
    this.config = config;
    this._state = config.initial;
  }

  /**
   * Get current state
   */
  get state(): S {
    return this._state;
  }

  /**
   * Check if a transition is valid from the current state
   */
  canTransition(event: E): boolean {
    const transition = this.config.transitions[event];
    if (!transition) {return false;}

    const allowedFrom = Array.isArray(transition.from)
      ? transition.from
      : [transition.from];
    return allowedFrom.includes(this._state);
  }

  /**
   * Get the target state for an event (without transitioning)
   * Returns undefined if event is not defined
   */
  getTargetState(event: E): S | undefined {
    const transition = this.config.transitions[event];
    return transition?.to;
  }

  /**
   * Get all events that are valid from the current state
   */
  getValidEvents(): E[] {
    return (Object.keys(this.config.transitions) as E[]).filter((event) =>
      this.canTransition(event)
    );
  }

  /**
   * Execute a state transition
   * @throws InvalidTransitionError if transition is not valid from current state
   */
  transition(event: E): S {
    const transitionConfig = this.config.transitions[event];

    if (!transitionConfig) {
      const error = new InvalidTransitionError(this._state, event, []);
      this.config.onInvalidTransition?.(this._state, event, []);
      throw error;
    }

    const allowedFrom = Array.isArray(transitionConfig.from)
      ? transitionConfig.from
      : [transitionConfig.from];

    if (!allowedFrom.includes(this._state)) {
      const error = new InvalidTransitionError(this._state, event, allowedFrom);
      this.config.onInvalidTransition?.(this._state, event, allowedFrom);
      throw error;
    }

    const previousState = this._state;
    this._state = transitionConfig.to;

    this.config.onTransition?.(previousState, this._state, event);

    return this._state;
  }

  /**
   * Try to execute a transition, returning success/failure instead of throwing
   */
  tryTransition(event: E): TransitionResult<S> {
    try {
      const state = this.transition(event);
      return { success: true, state };
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        return { success: false, state: this._state, error };
      }
      throw error;
    }
  }

  /**
   * Force state to a specific value (use sparingly - bypasses transition validation)
   * Useful for recovery or initial state restoration
   */
  forceState(state: S): void {
    this._state = state;
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this._state = this.config.initial;
  }

  /**
   * Check if machine is in a specific state
   */
  isIn(state: S): boolean {
    return this._state === state;
  }

  /**
   * Check if machine is in any of the specified states
   */
  isInAny(states: S[]): boolean {
    return states.includes(this._state);
  }
}
