/**
 * EventBus - Pub/sub event system
 *
 * Provides a centralized event system for loose coupling between components.
 * Uses typed events for type safety.
 *
 * Reliability features:
 * - Handler isolation: Snapshots handlers before iteration to prevent modification during emit
 * - Queued recursive emits: Prevents re-entrance by queueing emits during an emit cycle
 * - Error containment: Handler errors don't affect other handlers
 */

import { EventType, EventPayloads, EventHandler, IEventBus } from '../types';
import { ILogger } from './Logger';

/**
 * Queued event for deferred emission
 */
interface QueuedEvent<T extends EventType = EventType> {
  event: T;
  payload: EventPayloads[T];
}

/**
 * Event bus implementation with re-entrance protection
 */
export class EventBus implements IEventBus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlers: Map<EventType, Set<EventHandler<any>>> = new Map();
  private logger?: ILogger;

  // Re-entrance protection
  private _isEmitting = false;
  private _eventQueue: QueuedEvent[] = [];

  /**
   * Create a new EventBus
   * @param logger Optional logger for error reporting
   */
  constructor(logger?: ILogger) {
    this.logger = logger;
  }

  /**
   * Subscribe to an event
   */
  on<T extends EventType>(event: T, handler: EventHandler<T>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  /**
   * Unsubscribe from an event
   */
  off<T extends EventType>(event: T, handler: EventHandler<T>): void {
    const eventHandlers = this.handlers.get(event);
    if (eventHandlers) {
      eventHandlers.delete(handler);
    }
  }

  /**
   * Emit an event
   *
   * If called during an emit cycle (re-entrance), the event is queued
   * and processed after the current cycle completes.
   */
  emit<T extends EventType>(event: T, payload: EventPayloads[T]): void {
    // Queue if already emitting (prevents re-entrance)
    if (this._isEmitting) {
      this._eventQueue.push({ event, payload });
      return;
    }

    this._isEmitting = true;
    try {
      this._emitImmediate(event, payload);

      // Process any queued events (from recursive emits)
      while (this._eventQueue.length > 0) {
        const queued = this._eventQueue.shift()!;
        this._emitImmediate(queued.event, queued.payload);
      }
    } finally {
      this._isEmitting = false;
    }
  }

  /**
   * Internal: Emit an event immediately (no queue check)
   */
  private _emitImmediate<T extends EventType>(event: T, payload: EventPayloads[T]): void {
    const eventHandlers = this.handlers.get(event);
    if (!eventHandlers || eventHandlers.size === 0) {
      return;
    }

    // Snapshot handlers to prevent modification during iteration
    const handlersSnapshot = Array.from(eventHandlers);

    for (const handler of handlersSnapshot) {
      try {
        handler(payload);
      } catch (error) {
        const err = error as Error;
        this.logger?.child({ component: 'EventBus' }).error(
          { err },
          `Error in event handler for ${event}`
        );

        // Queue recoverable error event (avoid infinite loop for error events)
        if (!event.startsWith('error:')) {
          // Queue instead of direct emit to prevent deep recursion
          this._eventQueue.push({
            event: 'error:recoverable',
            payload: {
              source: 'EventBus',
              code: 'HANDLER_ERROR',
              message: `Handler failed for event ${event}: ${err.message}`,
              context: { event, originalError: err.message },
            },
          });
        }
      }
    }
  }

  /**
   * Subscribe to an event for one-time execution
   */
  once<T extends EventType>(event: T, handler: EventHandler<T>): void {
    const wrappedHandler: EventHandler<T> = (payload) => {
      this.off(event, wrappedHandler);
      handler(payload);
    };
    this.on(event, wrappedHandler);
  }

  /**
   * Get the number of handlers for an event
   */
  listenerCount(event: EventType): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  /**
   * Remove all handlers for an event (or all events if no event specified)
   */
  removeAllListeners(event?: EventType): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }

  /**
   * Get all registered event types
   */
  eventNames(): EventType[] {
    return Array.from(this.handlers.keys());
  }
}
