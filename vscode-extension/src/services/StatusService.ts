/**
 * StatusService - Hook status parsing
 *
 * Parses Claude hook output to determine agent status.
 * Monitors status files written by hook scripts.
 */

import * as fs from 'fs';
import { agentPath } from '../pathUtils';
import { IStatusService, ParsedStatus, HookData, AgentStatus } from '../types';
import { getLogger, isLoggerInitialized } from './Logger';

/**
 * Status service implementation
 */
export class StatusService implements IStatusService {
    /**
     * Get the status directory path for a worktree
     */
    getStatusDirectory(worktreePath: string): string {
        return agentPath(worktreePath).join('.claude-agents', 'status').forNodeFs();
    }

    /**
     * Check status from hook-generated files
     */
    checkStatus(worktreePath: string): ParsedStatus | null {
        try {
            const statusDir = this.getStatusDirectory(worktreePath);

            if (!fs.existsSync(statusDir)) {
                return null;
            }

            // Find the most recently modified status file
            const files = fs.readdirSync(statusDir);
            if (files.length === 0) {
                return null;
            }

            const latestFile = this.findLatestFile(statusDir, files);
            if (!latestFile) {
                return null;
            }

            const content = fs.readFileSync(latestFile, 'utf-8').trim();
            return this.parseHookData(content);
        } catch (error) {
            if (isLoggerInitialized()) {
                getLogger().child('StatusService').debug('Failed to check status', error);
            }
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
                if (isLoggerInitialized()) {
                    getLogger().child('StatusService').debug('Failed to parse JSON hook data', error);
                }
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
    private findLatestFile(directory: string, files: string[]): string | null {
        let latestFile = '';
        let latestTime = 0;

        for (const file of files) {
            const filePath = `${directory}/${file}`;
            try {
                const stat = fs.statSync(filePath);
                if (stat.mtimeMs > latestTime) {
                    latestTime = stat.mtimeMs;
                    latestFile = filePath;
                }
            } catch {
                // Skip files we can't stat
            }
        }

        return latestFile || null;
    }

    /**
     * Clear status files for a worktree
     */
    clearStatus(worktreePath: string): void {
        try {
            const statusDir = this.getStatusDirectory(worktreePath);
            if (fs.existsSync(statusDir)) {
                const files = fs.readdirSync(statusDir);
                for (const file of files) {
                    fs.unlinkSync(`${statusDir}/${file}`);
                }
            }
        } catch {
            // Ignore errors
        }
    }
}

/**
 * Singleton instance
 */
let statusServiceInstance: StatusService | null = null;

/**
 * Get the global StatusService instance
 */
export function getStatusService(): StatusService {
    if (!statusServiceInstance) {
        statusServiceInstance = new StatusService();
    }
    return statusServiceInstance;
}

/**
 * Reset the global StatusService instance (for testing)
 */
export function resetStatusService(): void {
    statusServiceInstance = null;
}
