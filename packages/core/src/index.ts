/**
 * @opus-orchestra/core
 *
 * Platform-agnostic core logic for Opus Orchestra.
 * This package contains no VS Code or OS-specific dependencies.
 */

import * as path from 'node:path';

// Types
export * from './types';
export * from './types/stateMachines';

// Adapters (interfaces only)
export * from './adapters';

// Services
export * from './services';

// Managers
export * from './managers';

// Containers
export * from './containers';

// Utilities
export * from './utils/StateMachine';
export * from './utils/agentNames';
export * from './utils';

// Errors
export * from './errors';

/**
 * Get the path to the bundled coordination files.
 * These include slash commands, hooks, and scripts for agent coordination.
 */
export function getCoordinationPath(): string {
  // __dirname is the dist/ folder after build, coordination is at package root
  return path.join(__dirname, '..', 'coordination');
}
