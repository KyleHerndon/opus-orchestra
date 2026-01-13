/**
 * TodoService - Claude Code TODO list reader
 *
 * Reads TODO lists from Claude Code's ~/.claude/todos directory.
 * TODOs are stored per-session in JSON files.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ILogger } from './Logger';

/**
 * Single TODO item from Claude Code
 */
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
  id?: string;
  priority?: string;
}

/**
 * Complete TODO state for a session
 */
export interface TodoState {
  items: TodoItem[];
  sessionId: string;
  lastModified: Date;
}

/**
 * Service interface for reading Claude Code TODO lists
 */
export interface ITodoService {
  getTodosForSession(sessionId: string): TodoItem[] | null;
  getCurrentTodos(): TodoState | null;
  getActiveTodo(): TodoItem | null;
}

/**
 * Service for reading Claude Code TODO lists
 */
export class TodoService implements ITodoService {
  private logger?: ILogger;
  private todosDir: string;

  /**
   * Create a TodoService.
   *
   * @param logger - Optional logger
   * @param todosDir - Optional custom todos directory path (for Node.js fs operations).
   *                   If not provided, defaults to `~/.claude/todos` using os.homedir().
   *                   On Windows with WSL, pass a UNC path like `//wsl.localhost/Ubuntu/home/user/.claude/todos`.
   */
  constructor(logger?: ILogger, todosDir?: string) {
    this.logger = logger?.child({ component: 'TodoService' });
    // Claude Code stores TODOs in ~/.claude/todos
    // Allow custom path for cross-platform support (e.g., WSL paths on Windows)
    this.todosDir = todosDir ?? path.join(os.homedir(), '.claude', 'todos');
  }

  /**
   * Get the most recent TODO list from Claude Code
   */
  getCurrentTodos(): TodoState | null {
    try {
      if (!fs.existsSync(this.todosDir)) {
        return null;
      }

      const files = fs.readdirSync(this.todosDir);
      if (files.length === 0) {
        return null;
      }

      // Find the most recently modified TODO file
      const latestFile = this.findLatestFile(files);
      if (!latestFile) {
        return null;
      }

      const content = fs.readFileSync(latestFile.path, 'utf-8').trim();
      if (!content || content === '[]') {
        return null;
      }

      const items = JSON.parse(content) as TodoItem[];
      if (!Array.isArray(items) || items.length === 0) {
        return null;
      }

      // Extract session ID from filename
      const sessionId = path.basename(latestFile.path, '.json').split('-agent-')[0];

      return {
        items,
        sessionId,
        lastModified: latestFile.mtime,
      };
    } catch (error) {
      this.logger?.debug(`Failed to read TODOs: ${error}`);
      return null;
    }
  }

  /**
   * Get TODOs for a specific session ID (if available)
   */
  getTodosForSession(sessionId: string): TodoItem[] | null {
    try {
      this.logger?.debug(`Looking for TODOs for session: ${sessionId}`);
      this.logger?.debug(`Todos directory: ${this.todosDir}`);

      if (!fs.existsSync(this.todosDir)) {
        this.logger?.debug(`Todos directory does not exist`);
        return null;
      }

      const files = fs.readdirSync(this.todosDir);
      this.logger?.debug(`Found ${files.length} files in todos directory`);

      // Find all files that match this session ID
      const matchingFiles = files.filter(f => f.includes(sessionId) && f.endsWith('.json'));
      this.logger?.debug(`Matching files for session ${sessionId}: ${matchingFiles.join(', ') || 'none'}`);

      if (matchingFiles.length === 0) {
        return null;
      }

      // Sort by modification time (most recent first) and find first with content
      const sortedFiles = matchingFiles
        .map(f => {
          const filePath = path.join(this.todosDir, f);
          try {
            const stat = fs.statSync(filePath);
            return { path: filePath, mtime: stat.mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((f): f is { path: string; mtime: number } => f !== null)
        .sort((a, b) => b.mtime - a.mtime);

      // Try each file until we find one with content
      for (const file of sortedFiles) {
        const content = fs.readFileSync(file.path, 'utf-8').trim();
        if (content && content !== '[]') {
          const items = JSON.parse(content) as TodoItem[];
          if (Array.isArray(items) && items.length > 0) {
            return items;
          }
        }
      }

      return null;
    } catch (error) {
      this.logger?.debug(`Failed to read session TODOs: ${error}`);
      return null;
    }
  }

  /**
   * Get the active (in_progress) TODO item if any
   */
  getActiveTodo(): TodoItem | null {
    const state = this.getCurrentTodos();
    if (!state) {
      return null;
    }

    return state.items.find(item => item.status === 'in_progress') || null;
  }

  /**
   * Find the most recently modified file in the todos directory
   */
  private findLatestFile(files: string[]): { path: string; mtime: Date } | null {
    let latestFile = '';
    let latestTime = 0;
    let latestMtime: Date | null = null;

    for (const file of files) {
      if (!file.endsWith('.json')) {
        continue;
      }

      const filePath = path.join(this.todosDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs > latestTime) {
          latestTime = stat.mtimeMs;
          latestFile = filePath;
          latestMtime = stat.mtime;
        }
      } catch {
        // Skip files we can't stat
      }
    }

    if (!latestFile || !latestMtime) {
      return null;
    }

    return { path: latestFile, mtime: latestMtime };
  }
}
