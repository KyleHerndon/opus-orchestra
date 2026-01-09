/**
 * Tests for TerminalUIAdapter
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TerminalUIAdapter } from '../adapters/TerminalUIAdapter.js';

describe('TerminalUIAdapter', () => {
  let adapter: TerminalUIAdapter;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    adapter = new TerminalUIAdapter();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  describe('showInfo', () => {
    it('should log info message with blue icon', async () => {
      await adapter.showInfo('Test info message');

      expect(consoleSpy).toHaveBeenCalled();
      // console.log is called with (icon, message) as separate args
      const args = consoleSpy.mock.calls[0];
      const fullMessage = args.join(' ');
      expect(fullMessage).toContain('Test info message');
    });

    it('should return undefined when no items provided', async () => {
      const result = await adapter.showInfo('Message');
      expect(result).toBeUndefined();
    });
  });

  describe('showWarning', () => {
    it('should log warning message with yellow icon', async () => {
      await adapter.showWarning('Test warning message');

      expect(consoleSpy).toHaveBeenCalled();
      const args = consoleSpy.mock.calls[0];
      const fullMessage = args.join(' ');
      expect(fullMessage).toContain('Test warning message');
    });

    it('should return undefined when no items provided', async () => {
      const result = await adapter.showWarning('Warning');
      expect(result).toBeUndefined();
    });
  });

  describe('showError', () => {
    it('should log error message with red icon', async () => {
      await adapter.showError('Test error message');

      expect(consoleSpy).toHaveBeenCalled();
      const args = consoleSpy.mock.calls[0];
      const fullMessage = args.join(' ');
      expect(fullMessage).toContain('Test error message');
    });

    it('should return undefined when no items provided', async () => {
      const result = await adapter.showError('Error');
      expect(result).toBeUndefined();
    });
  });

  describe('setStatusMessage', () => {
    it('should log status message', () => {
      const dispose = adapter.setStatusMessage('Status message');

      expect(consoleSpy).toHaveBeenCalled();
      const call = consoleSpy.mock.calls[0][0] as string;
      expect(call).toContain('Status message');
      expect(typeof dispose).toBe('function');
    });

    it('should return a dispose function', () => {
      const dispose = adapter.setStatusMessage('Message');
      expect(() => dispose()).not.toThrow();
    });
  });

  describe('withProgress', () => {
    it('should show progress and complete successfully', async () => {
      const result = await adapter.withProgress(
        { title: 'Loading...' },
        async (progress, _token) => {
          progress.report({ message: 'Step 1' });
          return 'done';
        }
      );

      expect(result).toBe('done');
      expect(stdoutSpy).toHaveBeenCalled();
    });

    it('should report progress increments', async () => {
      await adapter.withProgress(
        { title: 'Processing' },
        async (progress, _token) => {
          progress.report({ message: 'Step 1', increment: 50 });
          progress.report({ message: 'Step 2', increment: 100 });
          return true;
        }
      );

      // Check that progress was reported
      const calls = stdoutSpy.mock.calls.map(c => c[0] as string);
      expect(calls.some(c => c.includes('50%') || c.includes('100%') || c.includes('Processing'))).toBe(true);
    });

    it('should handle task errors', async () => {
      await expect(
        adapter.withProgress(
          { title: 'Failing' },
          async () => {
            throw new Error('Task failed');
          }
        )
      ).rejects.toThrow('Task failed');
    });

    it('should support cancellation token', async () => {
      let tokenReceived = false;

      await adapter.withProgress(
        { title: 'Cancellable', cancellable: true },
        async (_progress, token) => {
          tokenReceived = true;
          expect(token.isCancellationRequested).toBe(false);
          expect(typeof token.onCancellationRequested).toBe('function');
          return true;
        }
      );

      expect(tokenReceived).toBe(true);
    });
  });

  describe('promptQuickPick display', () => {
    // Note: Full interactive testing would require mocking readline
    // These tests verify the display logic

    it('should be a function', () => {
      expect(typeof adapter.promptQuickPick).toBe('function');
    });
  });

  describe('promptInput', () => {
    it('should be a function', () => {
      expect(typeof adapter.promptInput).toBe('function');
    });
  });

  describe('confirm', () => {
    it('should be a function', () => {
      expect(typeof adapter.confirm).toBe('function');
    });
  });
});
