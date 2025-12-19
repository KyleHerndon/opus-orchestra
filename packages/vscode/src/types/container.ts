/**
 * Container/isolation-related types and constants
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Container type - extensible string for adapter lookup.
 * Built-in types: 'unisolated', 'docker', 'cloud-hypervisor'
 * Additional types can be registered via adapters.
 */
export type ContainerType = 'unisolated' | 'docker' | 'cloud-hypervisor' | string;

/**
 * Container config reference - points to type + definition file.
 * The extension doesn't parse container-specific fields; it passes the
 * definition file path to the adapter.
 */
export interface ContainerConfigRef {
    /** Container type (determines which adapter to use) */
    type: ContainerType;
    /** Path to container definition file (relative to config location) */
    file?: string;
}

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
 * Runtime container/sandbox info
 */
export interface ContainerInfo {
    id: string;
    /** Config name (e.g., 'unisolated', 'repo:dev', 'user:secure') */
    configName: string;
    /** Container type from the config */
    type: ContainerType;
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
    /** Config name (e.g., 'unisolated', 'repo:dev', 'user:secure') */
    configName: string;
    /** Container type from the config */
    type: ContainerType;
    agentId: number;
    worktreePath: string;
    proxyPort?: number;
    createdAt: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Container type descriptions for UI
 */
export const CONTAINER_TYPE_DESCRIPTIONS: Record<string, string> = {
    'unisolated': 'No isolation - runs directly on host',
    'docker': 'Container isolation with hardened security options',
    'cloud-hypervisor': 'Full VM isolation with virtio-fs mounts',
};

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
