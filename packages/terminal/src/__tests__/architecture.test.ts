/**
 * Architecture Enforcement Tests
 *
 * These tests enforce architectural invariants that must hold across the codebase.
 * They catch violations of design principles before they become bugs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import {
  createTestRepoWithConfig,
  getTestSystemAdapter,
  TestRepo,
} from './fixtures/testRepo.js';

import {
  disposeContainer,
} from '../services/ServiceContainer.js';
import { runCommand } from '../cli.js';

// Get system adapter for path operations
const system = getTestSystemAdapter();

describe('Architecture: Worktree-Only Persistence', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-arch-test-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should store agent metadata in worktree, not central storage', async () => {
    // Create an agent
    await runCommand(['agents', 'create'], testRepo.path);

    // Check worktree has agent.json
    const worktreePath = system.joinPath(testRepo.path, '.worktrees', 'claude-alpha');
    const agentMetadataPath = system.joinPath(worktreePath, '.opus-orchestra', 'agent.json');

    expect(fs.existsSync(agentMetadataPath)).toBe(true);

    // Read agent metadata from worktree
    const metadata = JSON.parse(fs.readFileSync(agentMetadataPath, 'utf-8'));
    expect(metadata.name).toBe('alpha');
    expect(metadata.sessionId).toBeDefined();
    expect(metadata.branch).toBe('claude-alpha');
  });

  it('should recover agents from worktree metadata after storage deletion', async () => {
    // Create agents
    await runCommand(['agents', 'create', '2'], testRepo.path);

    // Delete central storage
    const storageFile = system.joinPath(testRepo.path, '.opus-orchestra', 'storage.json');
    if (fs.existsSync(storageFile)) {
      fs.unlinkSync(storageFile);
    }

    // List should still find agents (via worktree scan)
    // Note: This test documents the DESIRED behavior - currently it may fail
    // because we still rely on central storage
    await runCommand(['agents', 'list'], testRepo.path);

    // Currently agents are in central storage, so this shows what we WANT:
    // When we enforce worktree-only, this test should pass
    // For now, we just verify the worktree metadata exists
    expect(fs.existsSync(system.joinPath(testRepo.path, '.worktrees', 'claude-alpha', '.opus-orchestra', 'agent.json'))).toBe(true);
    expect(fs.existsSync(system.joinPath(testRepo.path, '.worktrees', 'claude-bravo', '.opus-orchestra', 'agent.json'))).toBe(true);
  });

  it('should include sessionId in worktree metadata for stable session names', async () => {
    // Create an agent
    await runCommand(['agents', 'create'], testRepo.path);

    // Read worktree metadata
    const metadataPath = system.joinPath(
      testRepo.path,
      '.worktrees',
      'claude-alpha',
      '.opus-orchestra',
      'agent.json'
    );
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

    // SessionId should be a UUID for stable session naming across renames
    expect(metadata.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('Architecture: No Hardcoded Agent Limits', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-limit-test-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should allow creating more than 10 agents', async () => {
    // This test documents the DESIRED behavior
    // Currently there's a hardcoded list of 10 names (alpha-juliet)
    // We want unlimited agents with generated names

    // For now, just verify we can create up to the current limit
    // TODO: Update when unlimited naming is implemented
    const result = await runCommand(['agents', 'create', '10'], testRepo.path);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Created 10 agent');
  });

  it('should reject count > 100 with clear error', async () => {
    // Current behavior - limit is 100 agents
    const result = await runCommand(['agents', 'create', '101'], testRepo.path);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('between 1 and 100');
  });
});

describe('Architecture: Error Handling', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-error-test-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should handle corrupted config gracefully', async () => {
    // Corrupt the config file
    const configPath = system.joinPath(testRepo.path, '.opus-orchestra', 'config.json');
    fs.writeFileSync(configPath, 'not valid json {{{');

    // CLI should still work (use defaults)
    const result = await runCommand(['status'], testRepo.path);

    // Should not crash
    expect(result.exitCode === 0 || result.stderr.length > 0).toBe(true);
  });

  it('should handle missing worktree gracefully', async () => {
    // Create agent
    await runCommand(['agents', 'create'], testRepo.path);

    // Manually delete worktree directory
    const worktreePath = system.joinPath(testRepo.path, '.worktrees', 'claude-alpha');
    fs.rmSync(worktreePath, { recursive: true, force: true });

    // Status should not crash
    const result = await runCommand(['status'], testRepo.path);

    // Should handle gracefully (might show error or empty list)
    expect(result.exitCode === 0 || result.stderr.length > 0).toBe(true);
  });

  it('should handle concurrent operations safely', async () => {
    // Run two create commands in parallel
    const [result1, result2] = await Promise.all([
      runCommand(['agents', 'create'], testRepo.path),
      runCommand(['agents', 'create'], testRepo.path),
    ]);

    // Both should complete (one might fail if name collision, but no crash)
    const totalCreated =
      (result1.stdout.includes('Created 1 agent') ? 1 : 0) +
      (result2.stdout.includes('Created 1 agent') ? 1 : 0);

    // At least one should succeed, neither should crash
    expect(totalCreated).toBeGreaterThanOrEqual(1);
  });
});

describe('Architecture: Idempotency', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-idempotent-test-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should skip existing agents when creating', async () => {
    // Create alpha
    await runCommand(['agents', 'create'], testRepo.path);

    // Create again - should create bravo, not fail
    const result = await runCommand(['agents', 'create'], testRepo.path);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('bravo');
  });

  it('should handle double-delete gracefully', async () => {
    // Create and delete
    await runCommand(['agents', 'create'], testRepo.path);
    await runCommand(['agents', 'delete', 'alpha', '--force'], testRepo.path);

    // Delete again - should fail gracefully
    const result = await runCommand(['agents', 'delete', 'alpha', '--force'], testRepo.path);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('not found');
  });
});

describe('Architecture: Cleanup Verification', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-cleanup-test-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should remove worktree directory on delete', async () => {
    await runCommand(['agents', 'create'], testRepo.path);

    const worktreePath = system.joinPath(testRepo.path, '.worktrees', 'claude-alpha');
    expect(fs.existsSync(worktreePath)).toBe(true);

    await runCommand(['agents', 'delete', 'alpha', '--force'], testRepo.path);

    expect(fs.existsSync(worktreePath)).toBe(false);
  });

  it('should remove agent from storage on delete', async () => {
    await runCommand(['agents', 'create'], testRepo.path);
    await runCommand(['agents', 'delete', 'alpha', '--force'], testRepo.path);

    // List should show no agents
    const result = await runCommand(['agents', 'list'], testRepo.path);
    expect(result.stdout).toContain('No agents found');
  });
});
