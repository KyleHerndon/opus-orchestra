/**
 * StatusService - Hook status parsing
 *
 * Parses Claude hook output to determine agent status.
 * Uses SystemAdapter for file operations - no OS-specific code.
 * Uses defensive file operations to handle race conditions.
 */

import { SystemAdapter } from '../adapters/SystemAdapter';
import { ParsedStatus, HookData } from '../types/hooks';
import { HookDataSchema, safeParse } from '../types/schemas';
import { ILogger } from './Logger';
import { safeReadDir, safeReadFile, safeGetMtime } from '../utils/safeFs';

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
    this.logger = logger?.child({ component: 'StatusService' });
  }

  /**
   * Get the status directory path for a worktree
   */
  getStatusDirectory(worktreePath: string): string {
    return this.system.joinPath(worktreePath, '.opus-orchestra', 'status');
  }

  /**
   * Check status from hook-generated files
   * Uses defensive file operations to handle race conditions
   * (e.g., file deleted between listing and reading)
   */
  checkStatus(worktreePath: string): ParsedStatus | null {
    try {
      const statusDir = this.getStatusDirectory(worktreePath);

      // Use safe read - returns empty array if dir doesn't exist
      const files = safeReadDir(this.system, statusDir);
      if (files.length === 0) {
        return null;
      }

      const fileInfo = this.findLatestFile(statusDir, files);
      if (!fileInfo) {
        return null;
      }

      // Use safe read - returns null if file was deleted between listing and reading
      const content = safeReadFile(this.system, fileInfo.path);
      if (content === null) {
        return null;
      }

      const parsed = this.parseHookData(content.trim());
      if (parsed) {
        parsed.fileTimestamp = fileInfo.mtime;
      }
      return parsed;
    } catch (error) {
      this.logger?.debug({ err: error }, 'Failed to check status');
      return null;
    }
  }

  /**
   * Parse hook data content using Zod validation
   */
  parseHookData(content: string): ParsedStatus | null {
    // Try to parse as JSON (raw hook output)
    if (content.startsWith('{')) {
      try {
        const rawData = JSON.parse(content);
        // Validate with Zod schema
        const data = safeParse(
          HookDataSchema,
          rawData,
          (error) => {
            this.logger?.debug(`Invalid hook data format: ${error.issues.map((e: { message: string }) => e.message).join(', ')}`);
          }
        );

        if (data) {
          return this.parseJsonHookData(data as HookData);
        }
      } catch (error) {
        this.logger?.debug({ err: error }, 'Failed to parse JSON hook data');
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
   * Uses safe operations to handle files being deleted during iteration
   */
  private findLatestFile(directory: string, files: string[]): { path: string; mtime: number } | null {
    let latestFile = '';
    let latestTime = 0;

    for (const file of files) {
      const filePath = this.system.joinPath(directory, file);
      // Use safe getMtime - returns null if file was deleted
      const mtime = safeGetMtime(this.system, filePath);
      if (mtime !== null && mtime > latestTime) {
        latestTime = mtime;
        latestFile = filePath;
      }
    }

    return latestFile ? { path: latestFile, mtime: latestTime } : null;
  }

  /**
   * Clear status files for a worktree
   */
  clearStatus(worktreePath: string): void {
    const statusDir = this.getStatusDirectory(worktreePath);
    // Use safe read - returns empty array if dir doesn't exist
    const files = safeReadDir(this.system, statusDir);
    for (const file of files) {
      try {
        this.system.unlink(this.system.joinPath(statusDir, file));
      } catch {
        // Ignore individual file deletion errors
      }
    }
  }
}
