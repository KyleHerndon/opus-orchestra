/**
 * VSCodeUIAdapter - VS Code UI adapter
 *
 * Implements UIAdapter using VS Code's window API.
 */

import * as vscode from 'vscode';
import {
  UIAdapter,
  QuickPickItem,
  QuickPickOptions,
  InputOptions,
  ProgressOptions,
  ProgressReporter,
  CancellationToken,
} from '@opus-orchestra/core';

/**
 * VS Code UI adapter.
 * Uses vscode.window for notifications and prompts.
 */
export class VSCodeUIAdapter implements UIAdapter {
  async showInfo(message: string, ...items: string[]): Promise<string | undefined> {
    return vscode.window.showInformationMessage(message, ...items);
  }

  async showWarning(message: string, ...items: string[]): Promise<string | undefined> {
    return vscode.window.showWarningMessage(message, ...items);
  }

  async showError(message: string, ...items: string[]): Promise<string | undefined> {
    return vscode.window.showErrorMessage(message, ...items);
  }

  async promptInput(options: InputOptions): Promise<string | undefined> {
    return vscode.window.showInputBox({
      prompt: options.prompt,
      value: options.value,
      placeHolder: options.placeholder,
      title: options.title,
      validateInput: options.validateInput
        ? (value) => options.validateInput!(value) ?? null
        : undefined,
    });
  }

  async promptQuickPick(
    items: QuickPickItem[],
    options?: QuickPickOptions
  ): Promise<string | string[] | undefined> {
    const vscodeItems = items.map((item) => ({
      label: item.label,
      description: item.description,
      detail: item.detail,
      picked: item.picked,
      // Store value for later retrieval
      value: item.value,
    }));

    if (options?.canPickMany) {
      const selected = await vscode.window.showQuickPick(vscodeItems, {
        title: options?.title,
        placeHolder: options?.placeholder,
        canPickMany: true,
        matchOnDescription: options?.matchOnDescription,
      });

      if (!selected) {
        return undefined;
      }

      return selected.map((item) => (item as { value: string }).value);
    } else {
      const selected = await vscode.window.showQuickPick(vscodeItems, {
        title: options?.title,
        placeHolder: options?.placeholder,
        matchOnDescription: options?.matchOnDescription,
      });

      if (!selected) {
        return undefined;
      }

      return (selected as { value: string }).value;
    }
  }

  async confirm(
    message: string,
    confirmLabel = 'Yes',
    cancelLabel = 'No'
  ): Promise<boolean> {
    const result = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      confirmLabel,
      cancelLabel
    );
    return result === confirmLabel;
  }

  async withProgress<T>(
    options: ProgressOptions,
    task: (progress: ProgressReporter, token: CancellationToken) => Promise<T>
  ): Promise<T> {
    const location = this.mapProgressLocation(options.location);

    return vscode.window.withProgress(
      {
        location,
        title: options.title,
        cancellable: options.cancellable,
      },
      async (progress, token) => {
        // Create wrapped progress reporter
        const reporter: ProgressReporter = {
          report: (update) => {
            progress.report(update);
          },
        };

        // Create wrapped cancellation token
        const wrappedToken: CancellationToken = {
          isCancellationRequested: token.isCancellationRequested,
          onCancellationRequested: (callback) => {
            const disposable = token.onCancellationRequested(callback);
            return () => disposable.dispose();
          },
        };

        return task(reporter, wrappedToken);
      }
    );
  }

  setStatusMessage(message: string, timeout = 0): () => void {
    const disposable =
      timeout > 0
        ? vscode.window.setStatusBarMessage(message, timeout)
        : vscode.window.setStatusBarMessage(message);

    return () => disposable.dispose();
  }

  private mapProgressLocation(
    location?: 'notification' | 'statusbar' | 'window'
  ): vscode.ProgressLocation {
    switch (location) {
      case 'statusbar':
        return vscode.ProgressLocation.Window;
      case 'window':
        return vscode.ProgressLocation.Window;
      case 'notification':
      default:
        return vscode.ProgressLocation.Notification;
    }
  }
}
