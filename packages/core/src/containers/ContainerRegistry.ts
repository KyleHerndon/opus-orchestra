/**
 * ContainerRegistry - Registry for container adapters
 *
 * Manages registration and lookup of container adapters.
 */

import { ContainerAdapter } from './ContainerAdapter';

/**
 * Registry of container adapters by type.
 */
export class ContainerRegistry {
  private adapters = new Map<string, ContainerAdapter>();

  /**
   * Register a container adapter.
   */
  register(adapter: ContainerAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  /**
   * Get a container adapter by type.
   */
  get(type: string): ContainerAdapter | undefined {
    return this.adapters.get(type);
  }

  /**
   * Get all registered adapter types.
   */
  getTypes(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get all available adapter types (those whose container systems are installed).
   */
  async getAvailableTypes(): Promise<string[]> {
    const available: string[] = [];
    for (const [type, adapter] of this.adapters) {
      if (await adapter.isAvailable()) {
        available.push(type);
      }
    }
    return available;
  }

  /**
   * Check if an adapter is registered for a type.
   */
  has(type: string): boolean {
    return this.adapters.has(type);
  }

  /**
   * Get all registered adapters.
   */
  getAll(): ContainerAdapter[] {
    return Array.from(this.adapters.values());
  }
}
