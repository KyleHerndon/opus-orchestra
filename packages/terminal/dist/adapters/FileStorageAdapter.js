/**
 * FileStorageAdapter - File-based storage implementation
 *
 * Uses the `conf` library for persistent JSON file storage.
 * Stores data in `.opus-orchestra/storage.json` (project) or
 * `~/.config/opus-orchestra/storage.json` (user global).
 */
import Conf from 'conf';
export class FileStorageAdapter {
    store;
    /**
     * Create a new FileStorageAdapter.
     *
     * @param projectPath - Optional project directory for project-local storage
     */
    constructor(projectPath) {
        this.store = new Conf({
            projectName: 'opus-orchestra',
            configName: 'storage',
            cwd: projectPath ? `${projectPath}/.opus-orchestra` : undefined,
        });
    }
    get(key, defaultValue) {
        return this.store.get(key, defaultValue);
    }
    async set(key, value) {
        this.store.set(key, value);
    }
    async delete(key) {
        this.store.delete(key);
    }
    isAvailable() {
        try {
            // Test write/read to verify storage works
            const testKey = '__storage_test__';
            this.store.set(testKey, true);
            this.store.delete(testKey);
            return true;
        }
        catch {
            return false;
        }
    }
    keys() {
        return Object.keys(this.store.store);
    }
    async clear() {
        this.store.clear();
    }
    /**
     * Get the path to the storage file.
     */
    get path() {
        return this.store.path;
    }
}
//# sourceMappingURL=FileStorageAdapter.js.map