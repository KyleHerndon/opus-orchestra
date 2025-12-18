/**
 * Container adapter interface - adapters own all knowledge of container-specific config.
 * The extension doesn't parse container-specific fields; it just asks the adapter.
 */

/**
 * Display info returned by adapter for UI purposes.
 * Extension doesn't need to understand container internals.
 */
export interface ContainerDisplayInfo {
    name: string;
    description?: string;
    memoryLimit?: string;
    cpuLimit?: string;
}

/**
 * Container adapter interface.
 * Each container system (docker, firecracker, etc.) implements this interface.
 */
export interface ContainerAdapter {
    /** The container type this adapter handles (e.g., 'docker', 'firecracker') */
    readonly type: string;

    /**
     * Check if this adapter's container system is available on the host.
     * For docker: checks `docker info`
     * For firecracker: checks `firecracker --version`
     */
    isAvailable(): Promise<boolean>;

    /**
     * Read display info from a container definition file.
     * The adapter parses its own format (JSON, YAML, Dockerfile, etc.)
     * @param definitionPath - Absolute path to the container definition file
     */
    getDisplayInfo(definitionPath: string): Promise<ContainerDisplayInfo>;

    /**
     * Create a container from a definition file.
     * @param definitionPath - Absolute path to the container definition file
     * @param worktreePath - Path to the worktree to mount
     * @param agentId - Agent ID for labeling/naming
     * @returns Container ID (docker container ID, VM socket path, etc.)
     */
    create(definitionPath: string, worktreePath: string, agentId: number): Promise<string>;

    /**
     * Execute a command inside the container.
     * @param containerId - Container ID returned from create()
     * @param command - Command to execute
     * @returns Command output
     */
    exec(containerId: string, command: string): Promise<string>;

    /**
     * Destroy/remove the container.
     * @param containerId - Container ID returned from create()
     */
    destroy(containerId: string): Promise<void>;

    /**
     * Get live container stats (optional).
     * @param containerId - Container ID returned from create()
     * @returns Memory and CPU usage, or null if not available
     */
    getStats?(containerId: string): Promise<{ memoryMB: number; cpuPercent: number } | null>;
}
