/**
 * TerminalUIAdapter - Terminal-based UI implementation
 *
 * Implements UIAdapter using:
 * - chalk for colored console output
 * - readline for basic prompts
 * - ora for spinners (progress indication)
 *
 * Note: For interactive Ink-based prompts during the dashboard,
 * we use Ink components directly. This adapter is for non-interactive
 * CLI commands and background operations.
 */

import chalk from 'chalk';
import * as readline from 'node:readline';
import {
  print,
  type UIAdapter,
  type QuickPickItem,
  type QuickPickOptions,
  type InputOptions,
  type ProgressOptions,
  type ProgressReporter,
  type CancellationToken,
} from '@opus-orchestra/core';

export class TerminalUIAdapter implements UIAdapter {
  /**
   * Show an information message.
   */
  async showInfo(message: string, ...items: string[]): Promise<string | undefined> {
    print(chalk.blue('ℹ'), message);

    if (items.length > 0) {
      return this.promptSelect(items);
    }

    return undefined;
  }

  /**
   * Show a warning message.
   */
  async showWarning(message: string, ...items: string[]): Promise<string | undefined> {
    print(chalk.yellow('⚠'), message);

    if (items.length > 0) {
      return this.promptSelect(items);
    }

    return undefined;
  }

  /**
   * Show an error message.
   */
  async showError(message: string, ...items: string[]): Promise<string | undefined> {
    print(chalk.red('✖'), message);

    if (items.length > 0) {
      return this.promptSelect(items);
    }

    return undefined;
  }

  /**
   * Prompt for text input.
   */
  async promptInput(options: InputOptions): Promise<string | undefined> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      const prompt = options.title
        ? `${options.title}\n${options.prompt}: `
        : `${options.prompt}: `;

      rl.question(prompt, (answer) => {
        rl.close();

        if (!answer && options.value) {
          resolve(options.value);
          return;
        }

        if (options.validateInput) {
          const error = options.validateInput(answer);
          if (error) {
            print(chalk.red(error));
            resolve(undefined);
            return;
          }
        }

        resolve(answer || undefined);
      });
    });
  }

  /**
   * Show a quick pick selection dialog.
   */
  async promptQuickPick(
    items: QuickPickItem[],
    options?: QuickPickOptions
  ): Promise<string | string[] | undefined> {
    if (options?.title) {
      print(chalk.bold(options.title));
    }

    if (options?.placeholder) {
      print(chalk.dim(options.placeholder));
    }

    // Show numbered list
    items.forEach((item, index) => {
      const num = chalk.cyan(`[${index + 1}]`);
      const label = item.label;
      const desc = item.description ? chalk.dim(` - ${item.description}`) : '';
      print(`${num} ${label}${desc}`);
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      const prompt = options?.canPickMany
        ? 'Enter numbers separated by commas (or q to cancel): '
        : 'Enter number (or q to cancel): ';

      rl.question(prompt, (answer) => {
        rl.close();

        if (answer.toLowerCase() === 'q' || !answer) {
          resolve(undefined);
          return;
        }

        if (options?.canPickMany) {
          const indices = answer
            .split(',')
            .map((s) => parseInt(s.trim(), 10) - 1)
            .filter((i) => i >= 0 && i < items.length);

          if (indices.length === 0) {
            resolve(undefined);
            return;
          }

          resolve(indices.map((i) => items[i].value));
        } else {
          const index = parseInt(answer, 10) - 1;
          if (index >= 0 && index < items.length) {
            resolve(items[index].value);
          } else {
            resolve(undefined);
          }
        }
      });
    });
  }

  /**
   * Show a confirmation dialog.
   */
  async confirm(
    message: string,
    confirmLabel = 'Yes',
    cancelLabel = 'No'
  ): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      const prompt = `${message} [${confirmLabel[0].toLowerCase()}/${cancelLabel[0].toLowerCase()}]: `;

      rl.question(prompt, (answer) => {
        rl.close();

        const lower = answer.toLowerCase();
        resolve(
          lower === confirmLabel[0].toLowerCase() ||
            lower === confirmLabel.toLowerCase() ||
            lower === 'y' ||
            lower === 'yes'
        );
      });
    });
  }

  /**
   * Run an operation with progress indication.
   */
  async withProgress<T>(
    options: ProgressOptions,
    task: (progress: ProgressReporter, token: CancellationToken) => Promise<T>
  ): Promise<T> {
    let cancelled = false;
    const cancellationCallbacks: (() => void)[] = [];

    const token: CancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: (callback) => {
        cancellationCallbacks.push(callback);
        return () => {
          const index = cancellationCallbacks.indexOf(callback);
          if (index >= 0) {
            cancellationCallbacks.splice(index, 1);
          }
        };
      },
    };

    // Simple text-based progress
    let currentMessage = options.title;
    process.stdout.write(`${chalk.cyan('⠋')} ${currentMessage}`);

    const progress: ProgressReporter = {
      report: ({ message, increment }) => {
        if (message) {
          currentMessage = message;
        }
        // Clear line and rewrite
        process.stdout.write(`\r${chalk.cyan('⠋')} ${currentMessage}${increment ? ` (${increment}%)` : ''}`);
      },
    };

    // Handle Ctrl+C for cancellation
    const handleSigInt = () => {
      if (options.cancellable && !cancelled) {
        cancelled = true;
        token.isCancellationRequested = true;
        cancellationCallbacks.forEach((cb) => cb());
        print(chalk.yellow('\nCancelled'));
      }
    };

    if (options.cancellable) {
      process.on('SIGINT', handleSigInt);
    }

    try {
      const result = await task(progress, token);
      process.stdout.write(`\r${chalk.green('✔')} ${currentMessage}\n`);
      return result;
    } catch (error) {
      process.stdout.write(`\r${chalk.red('✖')} ${currentMessage}\n`);
      throw error;
    } finally {
      if (options.cancellable) {
        process.off('SIGINT', handleSigInt);
      }
    }
  }

  /**
   * Set status bar message (no-op for terminal, could use bottom bar).
   */
  setStatusMessage(message: string, _timeout?: number): () => void {
    print(chalk.dim(`[Status] ${message}`));
    return () => {};
  }

  /**
   * Helper: prompt for selection from string array.
   */
  private async promptSelect(items: string[]): Promise<string | undefined> {
    const quickPickItems: QuickPickItem[] = items.map((item) => ({
      label: item,
      value: item,
    }));

    const result = await this.promptQuickPick(quickPickItems);
    return typeof result === 'string' ? result : undefined;
  }
}
