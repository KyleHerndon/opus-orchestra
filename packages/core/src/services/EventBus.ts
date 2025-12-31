/**
 * EventBus - Pub/sub event system
 *
 * Provides a centralized event system for loose coupling between components.
 * Uses typed events for type safety.
 */

import { EventType, EventPayloads, EventHandler, IEventBus } from '../types';
import { ILogger } from './Logger';

/**
 * Event bus implementation
 */
export class EventBus implements IEventBus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlers: Map<EventType, Set<EventHandler<any>>> = new Map();
  private logger?: ILogger;

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
   */
  emit<T extends EventType>(event: T, payload: EventPayloads[T]): void {
    const eventHandlers = this.handlers.get(event);
    if (!eventHandlers) {
      return;
    }

    for (const handler of eventHandlers) {
      try {
        handler(payload);
      } catch (error) {
        this.logger?.child('EventBus').error(
          `Error in event handler for ${event}`,
          error as Error
        );
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
