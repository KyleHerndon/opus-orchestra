/**
 * FileStorageAdapter - File-based storage implementation
 *
 * Uses the `conf` library for persistent JSON file storage.
 * Stores data in `.opus-orchestra/storage.json` (project) or
 * `~/.config/opus-orchestra/storage.json` (user global).
 */
import type { StorageAdapter } from '@opus-orchestra/core';
export declare class FileStorageAdapter implements StorageAdapter {
    private store;
    /**
     * Create a new FileStorageAdapter.
     *
     * @param projectPath - Optional project directory for project-local storage
     */
    constructor(projectPath?: string);
    get<T>(key: string, defaultValue: T): T;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
    isAvailable(): boolean;
    keys(): string[];
    clear(): Promise<void>;
    /**
     * Get the path to the storage file.
     */
    get path(): string;
}
//# sourceMappingURL=FileStorageAdapter.d.ts.map