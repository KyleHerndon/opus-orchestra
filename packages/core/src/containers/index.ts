/**
 * Container adapters
 *
 * Platform-agnostic container adapter interfaces and implementations.
 */

// ContainerAdapter interface
export {
  ContainerAdapter,
  ContainerDisplayInfo,
  ContainerStats,
  ShellCommand,
} from './ContainerAdapter';

// ContainerRegistry
export { ContainerRegistry } from './ContainerRegistry';

// Adapter implementations
export { UnisolatedAdapter } from './UnisolatedAdapter';
export { DockerAdapter, DockerDefinition } from './DockerAdapter';
