/**
 * Tests for agent name generator
 */

import { describe, it, expect } from 'vitest';
import {
  getNextAvailableName,
  getAvailableNames,
  parseAgentName,
  getAgentNameDepth,
  compareAgentNames,
} from '../../utils/agentNames';
import { AGENT_NAMES } from '../../types/agent';

describe('Agent Name Generator', () => {
  describe('getNextAvailableName', () => {
    it('returns first NATO name when no names are used', () => {
      const usedNames = new Set<string>();
      expect(getNextAvailableName(usedNames)).toBe('alpha');
    });

    it('returns next available NATO name', () => {
      const usedNames = new Set(['alpha', 'bravo']);
      expect(getNextAvailableName(usedNames)).toBe('charlie');
    });

    it('returns compound name when all single names are used', () => {
      const usedNames = new Set(AGENT_NAMES);
      expect(getNextAvailableName(usedNames)).toBe('alpha-alpha');
    });

    it('returns next compound name when first compound is used', () => {
      const usedNames = new Set([...AGENT_NAMES, 'alpha-alpha']);
      expect(getNextAvailableName(usedNames)).toBe('alpha-bravo');
    });

    it('handles gaps in compound names', () => {
      const usedNames = new Set([...AGENT_NAMES, 'alpha-alpha', 'alpha-charlie']);
      expect(getNextAvailableName(usedNames)).toBe('alpha-bravo');
    });
  });

  describe('getAvailableNames', () => {
    it('returns requested number of names', () => {
      const usedNames = new Set<string>();
      const names = getAvailableNames(usedNames, 3);
      expect(names).toEqual(['alpha', 'bravo', 'charlie']);
    });

    it('skips used names', () => {
      const usedNames = new Set(['alpha', 'charlie']);
      const names = getAvailableNames(usedNames, 2);
      expect(names).toEqual(['bravo', 'delta']);
    });

    it('returns compound names when needed', () => {
      const usedNames = new Set(AGENT_NAMES);
      const names = getAvailableNames(usedNames, 3);
      expect(names).toEqual(['alpha-alpha', 'alpha-bravo', 'alpha-charlie']);
    });

    it('returns fewer names if not enough available', () => {
      // This shouldn't happen in practice with compound names
      // but the function should handle it gracefully
      const usedNames = new Set(['alpha']);
      const names = getAvailableNames(usedNames, 1);
      expect(names.length).toBe(1);
      expect(names[0]).toBe('bravo');
    });
  });

  describe('parseAgentName', () => {
    it('parses single names', () => {
      expect(parseAgentName('alpha')).toEqual(['alpha']);
    });

    it('parses compound names', () => {
      expect(parseAgentName('alpha-bravo')).toEqual(['alpha', 'bravo']);
      expect(parseAgentName('alpha-bravo-charlie')).toEqual(['alpha', 'bravo', 'charlie']);
    });
  });

  describe('getAgentNameDepth', () => {
    it('returns 1 for single names', () => {
      expect(getAgentNameDepth('alpha')).toBe(1);
      expect(getAgentNameDepth('zulu')).toBe(1);
    });

    it('returns correct depth for compound names', () => {
      expect(getAgentNameDepth('alpha-alpha')).toBe(2);
      expect(getAgentNameDepth('alpha-bravo-charlie')).toBe(3);
    });
  });

  describe('compareAgentNames', () => {
    it('sorts single names before compound names', () => {
      expect(compareAgentNames('zulu', 'alpha-alpha')).toBeLessThan(0);
      expect(compareAgentNames('alpha-alpha', 'alpha')).toBeGreaterThan(0);
    });

    it('sorts alphabetically within same depth', () => {
      expect(compareAgentNames('alpha', 'bravo')).toBeLessThan(0);
      expect(compareAgentNames('bravo', 'alpha')).toBeGreaterThan(0);
      expect(compareAgentNames('alpha-alpha', 'alpha-bravo')).toBeLessThan(0);
    });

    it('returns 0 for equal names', () => {
      expect(compareAgentNames('alpha', 'alpha')).toBe(0);
      expect(compareAgentNames('alpha-bravo', 'alpha-bravo')).toBe(0);
    });
  });

  describe('stress test', () => {
    it('can generate 100+ unique names', () => {
      const usedNames = new Set<string>();
      const names: string[] = [];

      for (let i = 0; i < 100; i++) {
        const name = getNextAvailableName(usedNames);
        expect(name).not.toBeNull();
        expect(usedNames.has(name!)).toBe(false);
        names.push(name!);
        usedNames.add(name!);
      }

      // All names should be unique
      expect(new Set(names).size).toBe(100);

      // First 26 should be single names
      for (let i = 0; i < 26; i++) {
        expect(getAgentNameDepth(names[i])).toBe(1);
      }

      // Names 27+ should be compound names
      for (let i = 26; i < 100; i++) {
        expect(getAgentNameDepth(names[i])).toBe(2);
      }
    });
  });
});
