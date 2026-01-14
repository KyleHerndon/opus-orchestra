/**
 * Version information - re-exports from generated file
 */
export { VERSION_INFO } from './generated/version.js';
import { VERSION_INFO } from './generated/version.js';
/**
 * Get formatted version string for display
 */
export function getVersionString() {
    const { version, branch, timestamp } = VERSION_INFO;
    const date = new Date(timestamp).toLocaleDateString();
    return `${version} (${branch}) built ${date}`;
}
/**
 * Get short version for compact display
 */
export function getShortVersion() {
    return VERSION_INFO.version;
}
//# sourceMappingURL=version.js.map