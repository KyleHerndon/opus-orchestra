/**
 * VSCode Agent type - re-exports from core
 *
 * The vscode package now uses the core Agent type directly.
 * This enables type compatibility with core managers without unsafe casts.
 */

// Re-export Agent directly from core - now using TerminalHandle
export { Agent } from '@opus-orchestra/core';
