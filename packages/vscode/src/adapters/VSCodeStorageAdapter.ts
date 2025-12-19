/**
 * VSCodeStorageAdapter - VS Code workspace state storage
 *
 * Implements StorageAdapter using VS Code's ExtensionContext.workspaceState.
 */

import * as vscode from 'vscode';
import { StorageAdapter } from '@opus-orchestra/core';

/**
 * VS Code workspace state storage adapter.
 * Uses ExtensionContext.workspaceState for persistence.
 */
export class VSCodeStorageAdapter implements StorageAdapter {
  private context: vscode.ExtensionContext | null = null;

  /**
   * Initialize the storage adapter with extension context.
   * Must be called during extension activation.
   */
  initialize(context: vscode.ExtensionContext): void {
    this.context = context;
  }

  get<T>(key: string, defaultValue: T): T {
    if (!this.context) {
      return defaultValue;
    }
    return this.context.workspaceState.get<T>(key, defaultValue);
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (!this.context) {
      return;
    }
    await this.context.workspaceState.update(key, value);
  }

  async delete(key: string): Promise<void> {
    if (!this.context) {
      return;
    }
    await this.context.workspaceState.update(key, undefined);
  }

  isAvailable(): boolean {
    return this.context !== null;
  }

  keys(): string[] {
    if (!this.context) {
      return [];
    }
    return [...this.context.workspaceState.keys()];
  }

  async clear(): Promise<void> {
    if (!this.context) {
      return;
    }
    for (const key of this.context.workspaceState.keys()) {
      await this.context.workspaceState.update(key, undefined);
    }
  }
}
