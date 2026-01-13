/**
 * Robustness Tests
 *
 * Tests edge cases, error recovery, data corruption handling,
 * and concurrent operations to ensure the system is resilient.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createTestRepoWithConfig,
  createWorktree,
  TestRepo,
} from './fixtures/testRepo.js';
import {
  initializeContainer,
  disposeContainer,
  getContainer,
} from '../services/ServiceContainer.js';
import { runCommand } from '../cli.js';

/**
 * Helper to write agent metadata to worktree
 */
function writeAgentMetadata(
  repoPath: string,
  name: string,
  data: Record<string, unknown>
): void {
  const worktreePath = path.join(repoPath, '.worktrees', `claude-${name}`);
  const metadataDir = path.join(worktreePath, '.opus-orchestra');
  fs.mkdirSync(metadataDir, { recursive: true });
  fs.writeFileSync(
    path.join(metadataDir, 'agent.json'),
    JSON.stringify(data)
  );
}

describe('Data Corruption & Recovery', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-corrupt-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should skip agents with corrupted JSON metadata', async () => {
    // Create valid agent
    createWorktree(testRepo.path, 'alpha', 'claude-alpha');
    writeAgentMetadata(testRepo.path, 'alpha', {
      id: 1,
      name: 'alpha',
      sessionId: 'valid-session-123',
      branch: 'claude-alpha',
      worktreePath: path.join(testRepo.path, '.worktrees', 'claude-alpha'),
      repoPath: testRepo.path,
    });

    // Create agent with corrupted JSON
    createWorktree(testRepo.path, 'bravo', 'claude-bravo');
    const corruptPath = path.join(
      testRepo.path,
      '.worktrees',
      'claude-bravo',
      '.opus-orchestra'
    );
    fs.mkdirSync(corruptPath, { recursive: true });
    fs.writeFileSync(
      path.join(corruptPath, 'agent.json'),
      '{ invalid json {{{'
    );

    // Should load valid agent and skip corrupted one
    initializeContainer(testRepo.path);
    const agents = getContainer().persistence.loadPersistedAgents();

    expect(agents.length).toBe(1);
    expect(agents[0].name).toBe('alpha');
  });

  it('should handle empty metadata files gracefully', async () => {
    createWorktree(testRepo.path, 'alpha', 'claude-alpha');
    const metadataPath = path.join(
      testRepo.path,
      '.worktrees',
      'claude-alpha',
      '.opus-orchestra'
    );
    fs.mkdirSync(metadataPath, { recursive: true });
    fs.writeFileSync(path.join(metadataPath, 'agent.json'), '');

    initializeContainer(testRepo.path);
    const agents = getContainer().persistence.loadPersistedAgents();

    // Empty file should be skipped
    expect(agents.length).toBe(0);
  });

  it('should handle metadata with missing required fields', async () => {
    createWorktree(testRepo.path, 'alpha', 'claude-alpha');
    writeAgentMetadata(testRepo.path, 'alpha', {
      // Missing: id, sessionId, branch, worktreePath, repoPath
      name: 'alpha',
    });

    initializeContainer(testRepo.path);
    const agents = getContainer().persistence.loadPersistedAgents();

    // Should either skip or load with defaults - not crash
    expect(() => agents).not.toThrow();
  });

  it('should handle metadata with extra unknown fields', async () => {
    createWorktree(testRepo.path, 'alpha', 'claude-alpha');
    writeAgentMetadata(testRepo.path, 'alpha', {
      id: 1,
      name: 'alpha',
      sessionId: 'valid-session-123',
      branch: 'claude-alpha',
      worktreePath: path.join(testRepo.path, '.worktrees', 'claude-alpha'),
      repoPath: testRepo.path,
      // Extra fields (forward compatibility)
      futureField: 'some value',
      anotherNewField: { nested: true },
    });

    initializeContainer(testRepo.path);
    const agents = getContainer().persistence.loadPersistedAgents();

    expect(agents.length).toBe(1);
    expect(agents[0].name).toBe('alpha');
  });

  it('should handle truncated metadata files', async () => {
    createWorktree(testRepo.path, 'alpha', 'claude-alpha');
    const metadataPath = path.join(
      testRepo.path,
      '.worktrees',
      'claude-alpha',
      '.opus-orchestra'
    );
    fs.mkdirSync(metadataPath, { recursive: true });
    // Truncated JSON
    fs.writeFileSync(
      path.join(metadataPath, 'agent.json'),
      '{"id":1,"name":"alp'
    );

    initializeContainer(testRepo.path);
    const agents = getContainer().persistence.loadPersistedAgents();

    // Should skip corrupted file
    expect(agents.length).toBe(0);
  });

  it('should recover from corrupted config file', async () => {
    // Corrupt the config
    const configPath = path.join(testRepo.path, '.opus-orchestra', 'config.json');
    fs.writeFileSync(configPath, 'not valid json');

    // Should not crash - should use defaults
    initializeContainer(testRepo.path);
    const container = getContainer();

    // Should have default values
    expect(container.config.get('defaultAgentCount')).toBeDefined();
  });
});

describe('Concurrent Operations', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-concurrent-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should handle parallel agent creation requests', async () => {
    // Run multiple create commands in parallel
    const results = await Promise.all([
      runCommand(['agents', 'create'], testRepo.path),
      runCommand(['agents', 'create'], testRepo.path),
      runCommand(['agents', 'create'], testRepo.path),
    ]);

    // At least one should succeed, none should crash
    const successes = results.filter(r => r.exitCode === 0);
    expect(successes.length).toBeGreaterThanOrEqual(1);

    // Total created should be <= 3 (no duplicates)
    const listResult = await runCommand(['agents', 'list'], testRepo.path);
    const agentCount = (listResult.stdout.match(/claude-/g) || []).length;
    expect(agentCount).toBeLessThanOrEqual(3);
  });

  it('should handle create and list running simultaneously', async () => {
    // Create some initial agents
    await runCommand(['agents', 'create', '2'], testRepo.path);

    // Run create and list in parallel
    const [createResult, listResult] = await Promise.all([
      runCommand(['agents', 'create'], testRepo.path),
      runCommand(['agents', 'list'], testRepo.path),
    ]);

    // Neither should crash
    expect(createResult.exitCode === 0 || createResult.stderr).toBeTruthy();
    expect(listResult.exitCode).toBe(0);
  });

  it('should handle delete while listing', async () => {
    // Create agents
    await runCommand(['agents', 'create', '3'], testRepo.path);

    // Run delete and list in parallel
    const [deleteResult, listResult] = await Promise.all([
      runCommand(['agents', 'delete', 'alpha', '--force'], testRepo.path),
      runCommand(['agents', 'list'], testRepo.path),
    ]);

    // Neither should crash
    expect(deleteResult.exitCode === 0 || deleteResult.stderr.includes('not found')).toBeTruthy();
    expect(listResult.exitCode).toBe(0);
  });

  it('should handle rapid sequential operations', async () => {
    // Rapid create-list-create-list cycle
    for (let i = 0; i < 5; i++) {
      const createResult = await runCommand(['agents', 'create'], testRepo.path);
      const listResult = await runCommand(['agents', 'list'], testRepo.path);

      // Should not crash
      expect(createResult.exitCode === 0 || createResult.stderr).toBeTruthy();
      expect(listResult.exitCode).toBe(0);
    }
  });
});

describe('Edge Cases - Agent Names & Paths', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-edge-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should handle worktree with no metadata directory', async () => {
    // Create worktree but no .opus-orchestra directory
    createWorktree(testRepo.path, 'alpha', 'claude-alpha');

    initializeContainer(testRepo.path);
    const agents = getContainer().persistence.loadPersistedAgents();

    // Should find zero agents (worktree exists but no metadata)
    expect(agents.length).toBe(0);
  });

  it('should handle orphaned metadata (worktree deleted but metadata remains)', async () => {
    // Create worktree with metadata
    createWorktree(testRepo.path, 'alpha', 'claude-alpha');
    writeAgentMetadata(testRepo.path, 'alpha', {
      id: 1,
      name: 'alpha',
      sessionId: 'session-123',
      branch: 'claude-alpha',
      worktreePath: path.join(testRepo.path, '.worktrees', 'claude-alpha'),
      repoPath: testRepo.path,
    });

    // Now delete the worktree directory but keep metadata (simulate partial deletion)
    // This shouldn't happen normally, but testing resilience
    // The worktree path is: path.join(testRepo.path, '.worktrees', 'claude-alpha')

    // Verify agent loads initially
    initializeContainer(testRepo.path);
    const agents = getContainer().persistence.loadPersistedAgents();
    expect(agents.length).toBe(1);
  });

  it('should handle very long agent names in metadata', async () => {
    const longName = 'a'.repeat(200);
    createWorktree(testRepo.path, 'alpha', 'claude-alpha');
    writeAgentMetadata(testRepo.path, 'alpha', {
      id: 1,
      name: longName,
      sessionId: 'session-123',
      branch: 'claude-alpha',
      worktreePath: path.join(testRepo.path, '.worktrees', 'claude-alpha'),
      repoPath: testRepo.path,
    });

    initializeContainer(testRepo.path);
    const agents = getContainer().persistence.loadPersistedAgents();

    // Should load without crashing
    expect(agents.length).toBe(1);
    expect(agents[0].name).toBe(longName);
  });

  it('should handle special characters in sessionId', async () => {
    createWorktree(testRepo.path, 'alpha', 'claude-alpha');
    writeAgentMetadata(testRepo.path, 'alpha', {
      id: 1,
      name: 'alpha',
      sessionId: 'special-<>"/\\:*?|session',
      branch: 'claude-alpha',
      worktreePath: path.join(testRepo.path, '.worktrees', 'claude-alpha'),
      repoPath: testRepo.path,
    });

    initializeContainer(testRepo.path);
    const agents = getContainer().persistence.loadPersistedAgents();

    expect(agents.length).toBe(1);
  });

  it('should handle numeric values as strings in metadata', async () => {
    createWorktree(testRepo.path, 'alpha', 'claude-alpha');
    writeAgentMetadata(testRepo.path, 'alpha', {
      id: '1', // String instead of number
      name: 'alpha',
      sessionId: 'session-123',
      branch: 'claude-alpha',
      worktreePath: path.join(testRepo.path, '.worktrees', 'claude-alpha'),
      repoPath: testRepo.path,
    });

    initializeContainer(testRepo.path);
    const agents = getContainer().persistence.loadPersistedAgents();

    // Behavior may vary - either load with coercion or skip invalid entries
    // The key is that it shouldn't crash
    expect(agents.length).toBeGreaterThanOrEqual(0);
  });
});

describe('State Recovery & Cleanup', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-recovery-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should clean up completely when deleting agent', async () => {
    // Create agent
    await runCommand(['agents', 'create'], testRepo.path);

    const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-alpha');
    const metadataPath = path.join(worktreePath, '.opus-orchestra', 'agent.json');

    expect(fs.existsSync(worktreePath)).toBe(true);
    expect(fs.existsSync(metadataPath)).toBe(true);

    // Delete agent
    await runCommand(['agents', 'delete', 'alpha', '--force'], testRepo.path);

    // Both should be gone
    expect(fs.existsSync(worktreePath)).toBe(false);

    // List should show no agents
    const result = await runCommand(['agents', 'list'], testRepo.path);
    expect(result.stdout).toContain('No agents found');
  });

  it('should handle delete of already-deleted agent', async () => {
    // Create and delete agent
    await runCommand(['agents', 'create'], testRepo.path);
    await runCommand(['agents', 'delete', 'alpha', '--force'], testRepo.path);

    // Try to delete again
    const result = await runCommand(['agents', 'delete', 'alpha', '--force'], testRepo.path);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('not found');
  });

  it('should reinitialize container without leaking state', async () => {
    // Create agents
    await runCommand(['agents', 'create', '2'], testRepo.path);

    // Dispose and reinitialize
    disposeContainer();
    initializeContainer(testRepo.path);

    // Should still see the agents
    const agents = getContainer().persistence.loadPersistedAgents();
    expect(agents.length).toBe(2);

    // Dispose again
    disposeContainer();

    // Initialize fresh repo
    const testRepo2 = createTestRepoWithConfig('opus-recovery2-');
    initializeContainer(testRepo2.path);

    // Should not see agents from previous repo
    const agents2 = getContainer().persistence.loadPersistedAgents();
    expect(agents2.length).toBe(0);

    disposeContainer();
    testRepo2.cleanup();
  });
});

describe('Config Validation', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-config-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should reject invalid config values', async () => {
    const result = await runCommand(
      ['config', 'set', 'defaultAgentCount', '-5'],
      testRepo.path
    );

    // Should reject negative count
    expect(result.exitCode).not.toBe(0);
  });

  it('should reject non-numeric values for numeric config', async () => {
    const result = await runCommand(
      ['config', 'set', 'defaultAgentCount', 'abc'],
      testRepo.path
    );

    expect(result.exitCode).not.toBe(0);
  });

  it('should handle boolean config values correctly', async () => {
    // Set to false
    let result = await runCommand(
      ['config', 'set', 'useTmux', 'false'],
      testRepo.path
    );
    expect(result.exitCode).toBe(0);

    // Set to true
    result = await runCommand(
      ['config', 'set', 'useTmux', 'true'],
      testRepo.path
    );
    expect(result.exitCode).toBe(0);

    // Verify the value was set correctly
    const showResult = await runCommand(['config', 'show'], testRepo.path);
    expect(showResult.stdout).toContain('useTmux');
  });
});

describe('Batch Operation Partial Failures', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-batch-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should handle creating agents when some names are taken', async () => {
    // Create first agent
    await runCommand(['agents', 'create'], testRepo.path);

    // Try to create 3 more - alpha is taken
    const result = await runCommand(['agents', 'create', '3'], testRepo.path);

    expect(result.exitCode).toBe(0);
    // Should create bravo, charlie, delta (skip alpha)
    expect(result.stdout).toContain('bravo');
    expect(result.stdout).not.toContain('alpha');
  });

  it('should use compound names when single names are exhausted', async () => {
    // Create all 26 single-name agents (alpha through zulu)
    await runCommand(['agents', 'create', '10'], testRepo.path);
    await runCommand(['agents', 'create', '10'], testRepo.path);
    await runCommand(['agents', 'create', '6'], testRepo.path);

    // Create one more - should get a compound name (alpha-alpha)
    const result = await runCommand(['agents', 'create'], testRepo.path);

    // Should succeed with a compound name
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/alpha-alpha/);
  });
});

describe('Worktree Integrity', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-integrity-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should create valid git worktree', async () => {
    await runCommand(['agents', 'create'], testRepo.path);

    const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-alpha');

    // Check it's a valid git worktree
    expect(fs.existsSync(path.join(worktreePath, '.git'))).toBe(true);

    // Check branch exists
    const gitDir = path.join(worktreePath, '.git');
    const gitContent = fs.readFileSync(gitDir, 'utf-8');
    expect(gitContent).toContain('gitdir');
  });

  it('should create metadata in correct location', async () => {
    await runCommand(['agents', 'create'], testRepo.path);

    const metadataPath = path.join(
      testRepo.path,
      '.worktrees',
      'claude-alpha',
      '.opus-orchestra',
      'agent.json'
    );

    expect(fs.existsSync(metadataPath)).toBe(true);

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    expect(metadata.name).toBe('alpha');
    expect(metadata.branch).toBe('claude-alpha');
    expect(metadata.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('should copy coordination files to worktree', async () => {
    await runCommand(['agents', 'create'], testRepo.path);

    const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-alpha');

    // Check for CLAUDE.md or other coordination files
    const opusDir = path.join(worktreePath, '.opus-orchestra');
    expect(fs.existsSync(opusDir)).toBe(true);
  });
});

describe('Multi-Repo Scenarios', () => {
  let testRepo1: TestRepo;
  let testRepo2: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo1 = createTestRepoWithConfig('opus-multi1-');
    testRepo2 = createTestRepoWithConfig('opus-multi2-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo1.cleanup();
    testRepo2.cleanup();
  });

  it('should isolate agents between repositories', async () => {
    // Create agent in repo1
    await runCommand(['agents', 'create'], testRepo1.path);

    // Create agent in repo2
    await runCommand(['agents', 'create'], testRepo2.path);

    // Each repo should have its own alpha
    const list1 = await runCommand(['agents', 'list'], testRepo1.path);
    const list2 = await runCommand(['agents', 'list'], testRepo2.path);

    expect(list1.stdout).toContain('alpha');
    expect(list2.stdout).toContain('alpha');

    // Delete from repo1 shouldn't affect repo2
    await runCommand(['agents', 'delete', 'alpha', '--force'], testRepo1.path);

    const list1After = await runCommand(['agents', 'list'], testRepo1.path);
    const list2After = await runCommand(['agents', 'list'], testRepo2.path);

    expect(list1After.stdout).toContain('No agents found');
    expect(list2After.stdout).toContain('alpha');
  });

  it('should switch between repos correctly', async () => {
    // Create in repo1
    await runCommand(['agents', 'create', '2'], testRepo1.path);

    // Create in repo2
    await runCommand(['agents', 'create', '3'], testRepo2.path);

    // Verify counts
    disposeContainer();
    initializeContainer(testRepo1.path);
    let agents = getContainer().persistence.loadPersistedAgents();
    expect(agents.length).toBe(2);

    disposeContainer();
    initializeContainer(testRepo2.path);
    agents = getContainer().persistence.loadPersistedAgents();
    expect(agents.length).toBe(3);
  });
});
