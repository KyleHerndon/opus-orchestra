#!/usr/bin/env node
/**
 * Generate version info including git hash for build verification.
 *
 * Usage: node scripts/generate-version.js <output-path>
 *
 * Generates a TypeScript file with version info:
 * - commitHash: short git commit hash
 * - commitHashFull: full git commit hash
 * - dirty: true if there are uncommitted changes
 * - timestamp: build timestamp
 * - branch: current branch name
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function exec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function generateVersionInfo() {
  const commitHashFull = exec('git rev-parse HEAD') || 'unknown';
  const commitHash = exec('git rev-parse --short HEAD') || 'unknown';
  const branch = exec('git rev-parse --abbrev-ref HEAD') || 'unknown';

  // Check for uncommitted changes
  const status = exec('git status --porcelain');
  const dirty = status !== null && status.length > 0;

  // Build timestamp
  const timestamp = new Date().toISOString();

  return {
    commitHash,
    commitHashFull,
    dirty,
    branch,
    timestamp,
    version: `${commitHash}${dirty ? '-dirty' : ''}`,
  };
}

function generateTypeScript(info) {
  return `/**
 * Auto-generated version info - DO NOT EDIT
 * Generated at: ${info.timestamp}
 */

export const VERSION_INFO = {
  commitHash: '${info.commitHash}',
  commitHashFull: '${info.commitHashFull}',
  dirty: ${info.dirty},
  branch: '${info.branch}',
  timestamp: '${info.timestamp}',
  version: '${info.version}',
} as const;

export type VersionInfo = typeof VERSION_INFO;
`;
}

// Get output path from args or default
const outputPath = process.argv[2];

if (!outputPath) {
  console.error('Usage: node generate-version.js <output-path.ts>');
  process.exit(1);
}

const versionInfo = generateVersionInfo();

// Ensure directory exists
const dir = path.dirname(outputPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

// Write version info as TypeScript
fs.writeFileSync(outputPath, generateTypeScript(versionInfo));
console.log(`Generated version info: ${versionInfo.version} -> ${outputPath}`);
