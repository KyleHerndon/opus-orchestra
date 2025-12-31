/**
 * Hook/status-related types
 *
 * Types for parsing Claude hook output and status tracking.
 */

import { AgentStatus } from './agent';

/**
 * Hook event types from Claude
 */
export type HookEventType =
  | 'UserPromptSubmit'
  | 'PermissionRequest'
  | 'Stop'
  | 'SessionEnd';

/**
 * Raw hook data structure
 */
export interface HookData {
  session_id?: string;
  tool_name?: string;
  tool_input?: {
    command?: string;
    file_path?: string;
    [key: string]: unknown;
  };
  event_type?: HookEventType;
}

/**
 * Parsed status from hook output
 */
export interface ParsedStatus {
  status: AgentStatus;
  pendingApproval: string | null;
  /** Timestamp of the status file (ms since epoch) */
  fileTimestamp?: number;
}
