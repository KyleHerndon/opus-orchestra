/**
 * Container adapter exports.
 *
 * ContainerAdapter interface and core adapters (DockerAdapter, UnisolatedAdapter)
 * are re-exported from @opus-orchestra/core.
 *
 * CloudHypervisorAdapter is vscode-specific (not in core yet).
 */

// Re-export core container types and adapters
export {
    ContainerAdapter,
    ContainerDisplayInfo,
    ContainerStats,
    ShellCommand,
    ContainerRegistry,
    DockerAdapter,
    DockerDefinition,
    UnisolatedAdapter,
} from '@opus-orchestra/core';

// VSCode-specific container adapter (not in core yet)
export { CloudHypervisorAdapter, CloudHypervisorDefinition } from './CloudHypervisorAdapter';

// ProxyManager for CloudHypervisor vsock proxy
export { ProxyManager } from './vsockProxy';
