/**
 * Agent Name Generator
 *
 * Generates agent names using the NATO phonetic alphabet.
 * Supports unlimited agents through compound naming:
 * - Level 1: alpha, bravo, charlie, ... (26 names)
 * - Level 2: alpha-alpha, alpha-bravo, ..., zulu-zulu (676 names)
 * - Level 3+: alpha-alpha-alpha, ... (unlimited)
 *
 * Names are generated in order, so agents are created with predictable names.
 */

import { AGENT_NAMES } from '../types/agent';

/**
 * Generate the next available agent name given a set of used names.
 *
 * @param usedNames - Set of names that are already in use
 * @returns The next available name, or null if generation fails (shouldn't happen)
 */
export function getNextAvailableName(usedNames: Set<string>): string | null {
  // Try single names first (alpha, bravo, ...)
  for (const name of AGENT_NAMES) {
    if (!usedNames.has(name)) {
      return name;
    }
  }

  // Try compound names (alpha-alpha, alpha-bravo, ...)
  // We iterate through "depth levels" to keep names short when possible
  return getNextCompoundName(usedNames, 2);
}

/**
 * Get multiple available names at once.
 *
 * @param usedNames - Set of names that are already in use
 * @param count - Number of names to generate
 * @returns Array of available names
 */
export function getAvailableNames(usedNames: Set<string>, count: number): string[] {
  const names: string[] = [];
  const allUsed = new Set(usedNames);

  for (let i = 0; i < count; i++) {
    const name = getNextAvailableName(allUsed);
    if (name) {
      names.push(name);
      allUsed.add(name);
    } else {
      break;
    }
  }

  return names;
}

/**
 * Generate compound names at a specific depth level.
 * Depth 2 = alpha-alpha, depth 3 = alpha-alpha-alpha, etc.
 */
function getNextCompoundName(usedNames: Set<string>, depth: number): string | null {
  // Generate all compound names at this depth level
  const candidates = generateCompoundNamesAtDepth(depth);

  for (const name of candidates) {
    if (!usedNames.has(name)) {
      return name;
    }
  }

  // All names at this depth are used, try next depth
  // Safety limit to prevent infinite loops (depth 4 = 26^4 = 456,976 names)
  if (depth < 4) {
    return getNextCompoundName(usedNames, depth + 1);
  }

  // Extremely unlikely to reach here (would need 500k+ agents)
  return null;
}

/**
 * Generate all compound names at a specific depth.
 * Uses a generator to avoid creating huge arrays in memory.
 */
function* generateCompoundNamesAtDepth(depth: number): Generator<string> {
  if (depth < 2) {
    return;
  }

  // Generate indices for each position
  const indices = new Array(depth).fill(0);
  const base = AGENT_NAMES.length;

  while (true) {
    // Build name from current indices
    const parts = indices.map(i => AGENT_NAMES[i]);
    yield parts.join('-');

    // Increment indices (like counting in base-26)
    let pos = depth - 1;
    while (pos >= 0) {
      indices[pos]++;
      if (indices[pos] < base) {
        break;
      }
      indices[pos] = 0;
      pos--;
    }

    // If we've wrapped all positions, we're done
    if (pos < 0) {
      break;
    }
  }
}

/**
 * Parse an agent name to get its components.
 * Useful for sorting or displaying hierarchically.
 *
 * @param name - Agent name like "alpha" or "alpha-bravo"
 * @returns Array of name components
 */
export function parseAgentName(name: string): string[] {
  return name.split('-');
}

/**
 * Get the depth level of an agent name.
 * Single names = 1, compound names = 2+
 */
export function getAgentNameDepth(name: string): number {
  return name.split('-').length;
}

/**
 * Compare agent names for sorting.
 * Orders by: depth first, then alphabetically within depth.
 * So: alpha, bravo, ..., zulu, alpha-alpha, alpha-bravo, ...
 */
export function compareAgentNames(a: string, b: string): number {
  const depthA = getAgentNameDepth(a);
  const depthB = getAgentNameDepth(b);

  if (depthA !== depthB) {
    return depthA - depthB;
  }

  // Same depth - compare alphabetically
  return a.localeCompare(b);
}
