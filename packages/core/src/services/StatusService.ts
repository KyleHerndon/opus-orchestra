/**
 * StatusService - Hook status parsing
 *
 * Parses Claude hook output to determine agent status.
 * Uses SystemAdapter for file operations - no OS-specific code.
 */

import { SystemAdapter } from '../adapters/SystemAdapter';
import { ParsedStatus, HookData } from '../types/hooks';
import { ILogger } from './Logger';

/**
 * Status service interface
 */
export interface IStatusService {
  getStatusDirectory(worktreePath: string): string;
  checkStatus(worktreePath: string): ParsedStatus | null;
  parseHookData(content: string): ParsedStatus | null;
  clearStatus(worktreePath: string): void;
}

/**
 * Status service implementation
 */
export class StatusService implements IStatusService {
  private system: SystemAdapter;
  private logger?: ILogger;

  constructor(system: SystemAdapter, logger?: ILogger) {
    this.system = system;
    this.logger = logger?.child('StatusService');
  }

  /**
   * Get the status directory path for a worktree
   */
  getStatusDirectory(worktreePath: string): string {
    return this.system.joinPath(worktreePath, '.opus-orchestra', 'status');
  }

  /**
   * Check status from hook-generated files
   */
  checkStatus(worktreePath: string): ParsedStatus | null {
    try {
      const statusDir = this.getStatusDirectory(worktreePath);

      if (!this.system.exists(statusDir)) {
        return null;
      }

      // Find the most recently modified status file
      const files = this.system.readDir(statusDir);
      if (files.length === 0) {
        return null;
      }

      const fileInfo = this.findLatestFile(statusDir, files);
      if (!fileInfo) {
        return null;
      }

      const content = this.system.readFile(fileInfo.path).trim();
      const parsed = this.parseHookData(content);
      if (parsed) {
        parsed.fileTimestamp = fileInfo.mtime;
      }
      return parsed;
    } catch (error) {
      this.logger?.debug('Failed to check status', error);
      return null;
    }
  }

  /**
   * Parse hook data content
   */
  parseHookData(content: string): ParsedStatus | null {
    // Try to parse as JSON (raw hook output)
    if (content.startsWith('{')) {
      try {
        const data = JSON.parse(content) as HookData;
        return this.parseJsonHookData(data);
      } catch (error) {
        this.logger?.debug('Failed to parse JSON hook data', error);
      }
    }

    // Legacy format parsing (simple status strings)
    return this.parseLegacyStatus(content);
  }

  /**
   * Parse JSON hook data
   */
  private parseJsonHookData(data: HookData): ParsedStatus | null {
    // Check for PermissionRequest hook (has tool_name)
    if (data.tool_name) {
      const context = this.extractToolContext(data);
      return {
        status: 'waiting-approval',
        pendingApproval: context ? `${data.tool_name}: ${context}` : data.tool_name,
      };
    }

    // Check for other hook types by session_id presence
    if (data.session_id) {
      // Could be Stop, UserPromptSubmit, etc.
      return {
        status: 'working',
        pendingApproval: null,
      };
    }

    return null;
  }

  /**
   * Extract context from tool input
   */
  private extractToolContext(data: HookData): string {
    if (!data.tool_input) {
      return '';
    }

    const { tool_name, tool_input } = data;

    if (tool_name === 'Bash' && tool_input.command) {
      return String(tool_input.command);
    }

    if ((tool_name === 'Write' || tool_name === 'Edit') && tool_input.file_path) {
      return String(tool_input.file_path);
    }

    return '';
  }

  /**
   * Parse legacy status format
   */
  private parseLegacyStatus(content: string): ParsedStatus | null {
    const status = content.toLowerCase();

    switch (status) {
      case 'working':
        return { status: 'working', pendingApproval: null };
      case 'waiting':
        return { status: 'waiting-input', pendingApproval: null };
      case 'stopped':
        return { status: 'stopped', pendingApproval: null };
      default:
        return null;
    }
  }

  /**
   * Find the most recently modified file in a directory
   */
  private findLatestFile(directory: string, files: string[]): { path: string; mtime: number } | null {
    let latestFile = '';
    let latestTime = 0;

    for (const file of files) {
      const filePath = this.system.joinPath(directory, file);
      try {
        const mtime = this.system.getMtime(filePath);
        if (mtime > latestTime) {
          latestTime = mtime;
          latestFile = filePath;
        }
      } catch {
        // Skip files we can't stat
      }
    }

    return latestFile ? { path: latestFile, mtime: latestTime } : null;
  }

  /**
   * Clear status files for a worktree
   */
  clearStatus(worktreePath: string): void {
    try {
      const statusDir = this.getStatusDirectory(worktreePath);
      if (this.system.exists(statusDir)) {
        const files = this.system.readDir(statusDir);
        for (const file of files) {
          this.system.unlink(this.system.joinPath(statusDir, file));
        }
      }
    } catch {
      // Ignore errors
    }
  }
}
