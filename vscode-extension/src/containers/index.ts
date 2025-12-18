/**
 * Container adapter registry and exports.
 * Provides access to registered container adapters.
 */

export { ContainerAdapter, ContainerDisplayInfo } from './ContainerAdapter';
export { DockerAdapter, DockerDefinition } from './DockerAdapter';
export { FirecrackerAdapter, FirecrackerDefinition } from './FirecrackerAdapter';
export { UnisolatedAdapter } from './UnisolatedAdapter';

import { ContainerAdapter } from './ContainerAdapter';
import { DockerAdapter } from './DockerAdapter';
import { FirecrackerAdapter } from './FirecrackerAdapter';
import { UnisolatedAdapter } from './UnisolatedAdapter';

/**
 * Registry of container adapters by type.
 */
const containerAdapters = new Map<string, ContainerAdapter>();

/**
 * Register a container adapter.
 */
export function registerAdapter(adapter: ContainerAdapter): void {
    containerAdapters.set(adapter.type, adapter);
}

/**
 * Get a container adapter by type.
 */
export function getAdapter(type: string): ContainerAdapter | undefined {
    return containerAdapters.get(type);
}

/**
 * Get all registered adapter types.
 */
export function getAdapterTypes(): string[] {
    return Array.from(containerAdapters.keys());
}

/**
 * Get all available adapter types (those whose container systems are installed).
 */
export async function getAvailableTypes(): Promise<string[]> {
    const available: string[] = [];
    for (const [type, adapter] of containerAdapters) {
        if (await adapter.isAvailable()) {
            available.push(type);
        }
    }
    return available;
}

/**
 * Initialize the adapter registry with built-in adapters.
 */
export function initializeAdapters(): void {
    registerAdapter(new UnisolatedAdapter());
    registerAdapter(new DockerAdapter());
    registerAdapter(new FirecrackerAdapter());
}

// Initialize on module load
initializeAdapters();
