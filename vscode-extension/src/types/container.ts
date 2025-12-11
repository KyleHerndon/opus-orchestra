/**
 * Container/isolation-related types and constants
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Isolation tiers for sandboxed agents.
 * Higher tiers provide more isolation and allow more autonomy.
 */
export type IsolationTier =
    | 'standard'    // No isolation - manual approval required
    | 'sandbox'     // Lightweight OS-level isolation (bubblewrap/sandbox-exec)
    | 'docker'      // Container isolation with hardened security
    | 'gvisor'      // Kernel-level isolation via userspace syscall interception
    | 'firecracker'; // Full VM isolation with dedicated kernel

/**
 * Container lifecycle state
 */
export type ContainerState =
    | 'creating'
    | 'running'
    | 'stopped'
    | 'error'
    | 'not_created';

/**
 * Container mount configuration
 */
export interface ContainerMount {
    source: string;
    target: string;
    readonly?: boolean;
}

/**
 * Container configuration for a repository
 */
export interface ContainerConfig {
    /** Minimum required tier (won't run with less isolation) */
    minimumTier?: IsolationTier;
    /** Recommended tier */
    recommendedTier?: IsolationTier;
    /** Custom Docker image */
    image?: string;
    /** Dockerfile path (relative to repo) */
    dockerfile?: string;
    /** Network allowlist additions */
    allowedDomains?: string[];
    /** Memory limit (e.g., '4g') */
    memoryLimit?: string;
    /** CPU limit (e.g., '2') */
    cpuLimit?: string;
    /** Additional mounts */
    additionalMounts?: ContainerMount[];
    /** Environment variables (non-sensitive only) */
    environment?: Record<string, string>;
}

/**
 * Runtime container/sandbox info
 */
export interface ContainerInfo {
    id: string;
    tier: IsolationTier;
    state: ContainerState;
    agentId: number;
    worktreePath: string;
    proxyPort?: number;
    createdAt: Date;
    memoryUsageMB?: number;
    cpuPercent?: number;
}

/**
 * Persisted container data (saved to workspace state)
 */
export interface PersistedContainerInfo {
    id: string;
    tier: IsolationTier;
    agentId: number;
    worktreePath: string;
    proxyPort?: number;
    createdAt: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Isolation tier descriptions for UI
 */
export const ISOLATION_TIER_DESCRIPTIONS: Record<IsolationTier, string> = {
    'standard': 'No isolation - manual approval for all operations',
    'sandbox': 'Lightweight OS-level isolation (bubblewrap/sandbox-exec)',
    'docker': 'Container isolation with hardened security options',
    'gvisor': 'Kernel-level isolation via userspace syscall interception',
    'firecracker': 'Full VM isolation with dedicated kernel',
};

/**
 * Isolation tier order (for comparison)
 */
export const ISOLATION_TIER_ORDER: IsolationTier[] = [
    'standard', 'sandbox', 'docker', 'gvisor', 'firecracker'
];

/**
 * Container labels for identification
 */
export const CONTAINER_LABELS = {
    managed: 'opus-orchestra.managed=true',
    agentId: (id: number) => `opus-orchestra.agent-id=${id}`,
    worktree: (path: string) => `opus-orchestra.worktree-path=${path}`,
} as const;

/**
 * Paths blocked from container mounts (credential isolation)
 */
export const BLOCKED_HOST_PATHS = [
    '~/.ssh',
    '~/.aws',
    '~/.config/gh',
    '~/.gitconfig',
    '~/.netrc',
    '~/.docker/config.json',
    '~/.kube/config',
] as const;

/**
 * Default container image
 */
export const DEFAULT_CONTAINER_IMAGE = 'ghcr.io/kyleherndon/opus-orchestra-sandbox:latest';

/**
 * Storage key for container persistence
 */
export const CONTAINERS_STORAGE_KEY = 'claudeAgents.containers';

/**
 * Resource limit defaults
 */
export const CONTAINER_RESOURCE_DEFAULTS = {
    memory: '4g',
    cpu: '2',
    pidsLimit: 100,
    tmpSize: '100m',
    homeSize: '500m',
} as const;

/**
 * Default proxy port
 */
export const DEFAULT_PROXY_PORT = 8377;
