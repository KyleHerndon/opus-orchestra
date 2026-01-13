/**
 * Zod Schemas for Runtime Validation
 *
 * These schemas provide runtime validation for data structures that come from
 * external sources (files, user input, API responses). Using Zod instead of
 * manual type guards gives:
 * - Descriptive error messages
 * - Type inference
 * - Composable schemas
 * - Less code to maintain
 */

import { z } from 'zod';

// ============================================================================
// Agent Schemas
// ============================================================================

/**
 * Schema for persisted agent data (stored in worktree metadata)
 */
export const PersistedAgentSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().min(1),
  sessionId: z.string().min(1),
  branch: z.string().min(1),
  worktreePath: z.string().min(1),
  repoPath: z.string().min(1),
  taskFile: z.string().nullish(), // Can be null, undefined, or string
  containerConfigName: z.string().optional(),
  sessionStarted: z.boolean().optional(),
});

export type ValidatedPersistedAgent = z.infer<typeof PersistedAgentSchema>;

/**
 * Schema for diff stats
 */
export const DiffStatsSchema = z.object({
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  filesChanged: z.number().int().nonnegative(),
});

export type ValidatedDiffStats = z.infer<typeof DiffStatsSchema>;

/**
 * Schema for todo items
 */
export const AgentTodoItemSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed']),
  content: z.string(),
  activeForm: z.string().optional(),
});

export type ValidatedAgentTodoItem = z.infer<typeof AgentTodoItemSchema>;

// ============================================================================
// Hook Schemas
// ============================================================================

/**
 * Schema for hook event types
 */
export const HookEventTypeSchema = z.enum([
  'UserPromptSubmit',
  'PermissionRequest',
  'Stop',
  'SessionEnd',
]);

/**
 * Schema for raw hook data from Claude
 */
export const HookDataSchema = z.object({
  session_id: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.object({
    command: z.string().optional(),
    file_path: z.string().optional(),
  }).passthrough().optional(),
  event_type: HookEventTypeSchema.optional(),
}).passthrough(); // Allow additional unknown fields

export type ValidatedHookData = z.infer<typeof HookDataSchema>;

// ============================================================================
// Config Schemas
// ============================================================================

/**
 * Schema for terminal type
 */
export const TerminalTypeSchema = z.enum(['bash', 'wsl', 'powershell', 'cmd', 'gitbash']);

/**
 * Schema for log level
 */
export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

/**
 * Schema for full extension configuration
 * Matches ExtensionConfig interface in adapters/ConfigAdapter.ts
 */
export const ExtensionConfigSchema = z.object({
  // Agent settings
  defaultAgentCount: z.number().int().positive().default(3),
  autoStartClaude: z.boolean().default(false),
  autoStartClaudeOnFocus: z.boolean().default(true),
  claudeCommand: z.string().default('claude'),

  // Tmux settings
  useTmux: z.boolean().default(true),
  tmuxSessionPrefix: z.string().default('opus'),

  // Directory settings
  worktreeDirectory: z.string().default('.worktrees'),
  coordinationScriptsPath: z.string().default(''),
  backlogPath: z.string().default(''),
  repositoryPaths: z.array(z.string()).default([]),

  // Terminal settings
  terminalType: TerminalTypeSchema.default('bash'),

  // Polling intervals (ms)
  diffPollingInterval: z.number().int().positive().default(60000),

  // Container settings
  containerImage: z.string().default('ghcr.io/kyleherndon/opus-orchestra-sandbox:latest'),
  containerMemoryLimit: z.string().default('4g'),
  containerCpuLimit: z.string().default('2'),
  containerPidsLimit: z.number().int().positive().default(100),
  gvisorEnabled: z.boolean().default(false),
  cloudHypervisorPath: z.string().default(''),

  // Isolation settings
  isolationTier: z.string().default('standard'),
  allowedDomains: z.array(z.string()).default(['api.anthropic.com', 'registry.npmjs.org', 'pypi.org']),
  proxyPort: z.number().int().positive().default(8377),

  // Permission settings
  showAllPermissionOptions: z.boolean().default(false),

  // UI settings
  uiScale: z.number().positive().default(1),

  // Logging
  logLevel: LogLevelSchema.default('debug'),

  // API settings
  autoSwitchToApiOnRateLimit: z.boolean().default(false),
});

export type ValidatedExtensionConfig = z.infer<typeof ExtensionConfigSchema>;

/**
 * Partial config schema for updates (all fields optional)
 */
export const PartialExtensionConfigSchema = ExtensionConfigSchema.partial();

export type ValidatedPartialConfig = z.infer<typeof PartialExtensionConfigSchema>;

/**
 * Legacy alias for backwards compatibility
 * @deprecated Use ExtensionConfigSchema instead
 */
export const ConfigSchema = ExtensionConfigSchema;

// ============================================================================
// Container Schemas
// ============================================================================

/**
 * Schema for container configuration
 */
export const ContainerConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  image: z.string().optional(),
  runtime: z.enum(['docker', 'gvisor', 'cloud-hypervisor']).optional(),
  mounts: z.array(z.object({
    source: z.string(),
    target: z.string(),
    readonly: z.boolean().optional(),
  })).optional(),
  environment: z.record(z.string(), z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  securityOpts: z.array(z.string()).optional(),
});

export type ValidatedContainerConfig = z.infer<typeof ContainerConfigSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Safely parse data with a schema, returning null on failure
 *
 * @param schema - Zod schema to validate against
 * @param data - Unknown data to validate
 * @param onError - Optional callback for validation errors
 * @returns Validated data or null
 */
export function safeParse<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  onError?: (error: z.ZodError) => void
): z.infer<T> | null {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  onError?.(result.error);
  return null;
}

/**
 * Parse data with a schema, throwing on failure
 *
 * @param schema - Zod schema to validate against
 * @param data - Unknown data to validate
 * @returns Validated data
 * @throws ZodError if validation fails
 */
export function parse<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown
): z.infer<T> {
  return schema.parse(data);
}

/**
 * Get a formatted error message from a Zod error
 */
export function formatZodError(error: z.ZodError<unknown>): string {
  return error.issues
    .map((e) => `${e.path.map(String).join('.')}: ${e.message}`)
    .join('; ');
}
