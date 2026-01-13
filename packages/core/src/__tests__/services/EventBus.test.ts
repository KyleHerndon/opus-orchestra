/**
 * EventBus tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../../services/EventBus';
import { EventPayloads } from '../../types/events';
import { ILogger } from '../../services/Logger';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  describe('on/emit', () => {
    it('calls handler when event is emitted', () => {
      const handler = vi.fn();
      eventBus.on('agent:created', handler);

      const payload = { agent: { id: 1, name: 'test' } } as EventPayloads['agent:created'];
      eventBus.emit('agent:created', payload);

      expect(handler).toHaveBeenCalledWith(payload);
    });

    it('calls multiple handlers for same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      eventBus.on('agent:created', handler1);
      eventBus.on('agent:created', handler2);

      const payload = { agent: { id: 1, name: 'test' } } as EventPayloads['agent:created'];
      eventBus.emit('agent:created', payload);

      expect(handler1).toHaveBeenCalledWith(payload);
      expect(handler2).toHaveBeenCalledWith(payload);
    });

    it('does not call handler for different event', () => {
      const handler = vi.fn();
      eventBus.on('agent:created', handler);

      eventBus.emit('agent:deleted', { agentId: 1 });

      expect(handler).not.toHaveBeenCalled();
    });

    it('handles emit with no handlers', () => {
      // Should not throw
      expect(() => {
        eventBus.emit('agent:created', { agent: { id: 1 } } as EventPayloads['agent:created']);
      }).not.toThrow();
    });
  });

  describe('off', () => {
    it('removes handler', () => {
      const handler = vi.fn();
      eventBus.on('agent:created', handler);
      eventBus.off('agent:created', handler);

      eventBus.emit('agent:created', { agent: { id: 1 } } as EventPayloads['agent:created']);

      expect(handler).not.toHaveBeenCalled();
    });

    it('only removes specified handler', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      eventBus.on('agent:created', handler1);
      eventBus.on('agent:created', handler2);
      eventBus.off('agent:created', handler1);

      eventBus.emit('agent:created', { agent: { id: 1 } } as EventPayloads['agent:created']);

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('handles off for non-existent event', () => {
      const handler = vi.fn();
      // Should not throw
      expect(() => {
        eventBus.off('agent:created', handler);
      }).not.toThrow();
    });
  });

  describe('once', () => {
    it('calls handler only once', () => {
      const handler = vi.fn();
      eventBus.once('agent:created', handler);

      const payload = { agent: { id: 1 } } as EventPayloads['agent:created'];
      eventBus.emit('agent:created', payload);
      eventBus.emit('agent:created', payload);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes after first call', () => {
      const handler = vi.fn();
      eventBus.once('agent:created', handler);

      eventBus.emit('agent:created', { agent: { id: 1 } } as EventPayloads['agent:created']);

      expect(eventBus.listenerCount('agent:created')).toBe(0);
    });
  });

  describe('listenerCount', () => {
    it('returns 0 for event with no handlers', () => {
      expect(eventBus.listenerCount('agent:created')).toBe(0);
    });

    it('returns correct count for event with handlers', () => {
      eventBus.on('agent:created', vi.fn());
      eventBus.on('agent:created', vi.fn());
      eventBus.on('agent:deleted', vi.fn());

      expect(eventBus.listenerCount('agent:created')).toBe(2);
      expect(eventBus.listenerCount('agent:deleted')).toBe(1);
    });
  });

  describe('removeAllListeners', () => {
    it('removes all handlers for specific event', () => {
      eventBus.on('agent:created', vi.fn());
      eventBus.on('agent:created', vi.fn());
      eventBus.on('agent:deleted', vi.fn());

      eventBus.removeAllListeners('agent:created');

      expect(eventBus.listenerCount('agent:created')).toBe(0);
      expect(eventBus.listenerCount('agent:deleted')).toBe(1);
    });

    it('removes all handlers when no event specified', () => {
      eventBus.on('agent:created', vi.fn());
      eventBus.on('agent:deleted', vi.fn());

      eventBus.removeAllListeners();

      expect(eventBus.listenerCount('agent:created')).toBe(0);
      expect(eventBus.listenerCount('agent:deleted')).toBe(0);
    });
  });

  describe('eventNames', () => {
    it('returns empty array when no events registered', () => {
      expect(eventBus.eventNames()).toEqual([]);
    });

    it('returns registered event names', () => {
      eventBus.on('agent:created', vi.fn());
      eventBus.on('agent:deleted', vi.fn());

      const names = eventBus.eventNames();

      expect(names).toContain('agent:created');
      expect(names).toContain('agent:deleted');
      expect(names.length).toBe(2);
    });
  });

  describe('error handling', () => {
    it('continues calling handlers after one throws', () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Handler error');
      });
      const successHandler = vi.fn();

      eventBus.on('agent:created', errorHandler);
      eventBus.on('agent:created', successHandler);

      eventBus.emit('agent:created', { agent: { id: 1 } } as EventPayloads['agent:created']);

      expect(errorHandler).toHaveBeenCalled();
      expect(successHandler).toHaveBeenCalled();
    });

    it('logs errors when logger provided', () => {
      const mockLogger = {
        child: vi.fn().mockReturnValue({
          error: vi.fn(),
        }),
      };
      const busWithLogger = new EventBus(mockLogger as unknown as ILogger);

      busWithLogger.on('agent:created', () => {
        throw new Error('Test error');
      });

      busWithLogger.emit('agent:created', { agent: { id: 1 } } as EventPayloads['agent:created']);

      expect(mockLogger.child).toHaveBeenCalledWith({ component: 'EventBus' });
      expect(mockLogger.child().error).toHaveBeenCalled();
    });
  });
});
