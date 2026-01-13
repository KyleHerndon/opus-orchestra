/**
 * Version information - re-exports from generated file
 */

export { VERSION_INFO, VersionInfo } from './generated/version.js';

import { VERSION_INFO } from './generated/version.js';

/**
 * Get formatted version string for display
 */
export function getVersionString(): string {
  const { version, branch, timestamp } = VERSION_INFO;
  const date = new Date(timestamp).toLocaleDateString();
  return `${version} (${branch}) built ${date}`;
}

/**
 * Get short version for compact display
 */
export function getShortVersion(): string {
  return VERSION_INFO.version;
}
