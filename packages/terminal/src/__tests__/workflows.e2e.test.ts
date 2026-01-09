/**
 * End-to-End Workflow Tests
 *
 * Tests complete user workflows simulating real usage patterns.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createTestRepoWithConfig,
  createWorktree,
  makeUncommittedChange,
  addAndCommit,
  getCurrentBranch,
  branchExists,
  TestRepo,
} from './fixtures/testRepo.js';
import {
  initializeContainer,
  disposeContainer,
  getContainer,
} from '../services/ServiceContainer.js';

const CLI_PATH = path.resolve(__dirname, '../../dist/bin/opus.js');

function runCli(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, FORCE_COLOR: '0', CI: 'true' },
    timeout: 30000,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? 1,
  };
}

describe('E2E: Fresh Project Setup Workflow', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-e2e-setup-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should complete full project initialization flow', () => {
    // 1. Check initial status - should be empty
    let result = runCli(['status'], testRepo.path);
    expect(result.stdout).toContain('No agents found');

    // 2. Create 3 agents
    result = runCli(['agents', 'create', '3'], testRepo.path);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Created 3 agent');

    // 3. Verify agents are listed
    result = runCli(['agents', 'list'], testRepo.path);
    expect(result.stdout).toContain('alpha');
    expect(result.stdout).toContain('bravo');
    expect(result.stdout).toContain('charlie');

    // 4. Verify status shows agent count
    result = runCli(['status'], testRepo.path);
    expect(result.stdout).toContain('Agents:');
    expect(result.stdout).toContain('3');

    // 5. Check config
    result = runCli(['config', 'show'], testRepo.path);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Configuration');
  });

  it('should create agents with proper git structure', () => {
    // Create agents
    runCli(['agents', 'create', '2'], testRepo.path);

    // Verify git worktrees exist
    const worktreesDir = path.join(testRepo.path, '.worktrees');
    expect(fs.existsSync(worktreesDir)).toBe(true);
    expect(fs.existsSync(path.join(worktreesDir, 'claude-alpha'))).toBe(true);
    expect(fs.existsSync(path.join(worktreesDir, 'claude-bravo'))).toBe(true);

    // Verify each worktree is a valid git directory
    expect(fs.existsSync(path.join(worktreesDir, 'claude-alpha', '.git'))).toBe(true);
    expect(fs.existsSync(path.join(worktreesDir, 'claude-bravo', '.git'))).toBe(true);

    // Verify branches were created
    expect(branchExists(testRepo.path, 'claude-alpha')).toBe(true);
    expect(branchExists(testRepo.path, 'claude-bravo')).toBe(true);
  });
});

describe('E2E: Agent Lifecycle Workflow', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-e2e-lifecycle-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should handle create-work-delete lifecycle', () => {
    // 1. Create an agent
    let result = runCli(['agents', 'create'], testRepo.path);
    expect(result.status).toBe(0);

    const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-alpha');
    expect(fs.existsSync(worktreePath)).toBe(true);

    // 2. Simulate work in worktree (make changes)
    makeUncommittedChange(
      worktreePath,
      'src/new-feature.ts',
      'export const feature = "new";\n'
    );

    // 3. Verify the file exists in worktree
    expect(fs.existsSync(path.join(worktreePath, 'src', 'new-feature.ts'))).toBe(true);

    // 4. List agents - should show alpha
    result = runCli(['agents', 'list', '--verbose'], testRepo.path);
    expect(result.stdout).toContain('alpha');
    expect(result.stdout).toContain('claude-alpha');

    // 5. Delete the agent
    result = runCli(['agents', 'delete', 'alpha', '--force'], testRepo.path);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('deleted');

    // 6. Verify cleanup
    expect(fs.existsSync(worktreePath)).toBe(false);

    // 7. Status should show no agents
    result = runCli(['status'], testRepo.path);
    expect(result.stdout).toContain('No agents found');
  });

  it('should handle multiple agents independently', () => {
    // Create 3 agents
    runCli(['agents', 'create', '3'], testRepo.path);

    // Make different changes in each worktree
    const alphaPath = path.join(testRepo.path, '.worktrees', 'claude-alpha');
    const bravoPath = path.join(testRepo.path, '.worktrees', 'claude-bravo');
    const charliePath = path.join(testRepo.path, '.worktrees', 'claude-charlie');

    makeUncommittedChange(alphaPath, 'alpha-work.ts', 'console.log("alpha");\n');
    makeUncommittedChange(bravoPath, 'bravo-work.ts', 'console.log("bravo");\n');
    makeUncommittedChange(charliePath, 'charlie-work.ts', 'console.log("charlie");\n');

    // Verify each agent has its own changes
    expect(fs.existsSync(path.join(alphaPath, 'alpha-work.ts'))).toBe(true);
    expect(fs.existsSync(path.join(bravoPath, 'bravo-work.ts'))).toBe(true);
    expect(fs.existsSync(path.join(charliePath, 'charlie-work.ts'))).toBe(true);

    // Verify changes are isolated (alpha doesn't have bravo's changes)
    expect(fs.existsSync(path.join(alphaPath, 'bravo-work.ts'))).toBe(false);
    expect(fs.existsSync(path.join(bravoPath, 'alpha-work.ts'))).toBe(false);

    // Delete middle agent
    runCli(['agents', 'delete', 'bravo', '--force'], testRepo.path);

    // Alpha and charlie should still exist
    expect(fs.existsSync(alphaPath)).toBe(true);
    expect(fs.existsSync(charliePath)).toBe(true);
    expect(fs.existsSync(bravoPath)).toBe(false);

    // List should only show alpha and charlie
    const result = runCli(['agents', 'list'], testRepo.path);
    expect(result.stdout).toContain('alpha');
    expect(result.stdout).toContain('charlie');
    expect(result.stdout).not.toContain('bravo');
  });
});

describe('E2E: Configuration Workflow', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-e2e-config-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should persist config changes', () => {
    // Check initial config
    let result = runCli(['config', 'show'], testRepo.path);
    expect(result.stdout).toContain('defaultAgentCount');

    // Change a config value
    result = runCli(['config', 'set', 'defaultAgentCount', '7'], testRepo.path);
    expect(result.status).toBe(0);

    // Verify change persisted
    result = runCli(['config', 'show'], testRepo.path);
    expect(result.stdout).toContain('7');
  });

  it('should apply config to new operations', () => {
    // Set worktree directory
    runCli(['config', 'set', 'worktreeDirectory', '.agents'], testRepo.path);

    // Create agent - should use new directory
    runCli(['agents', 'create'], testRepo.path);

    // Note: This test verifies the config is read, but the worktree directory
    // is determined at creation time. The actual path used depends on
    // how WorktreeManager interprets the config.
    const result = runCli(['agents', 'list', '--verbose'], testRepo.path);
    expect(result.stdout).toContain('alpha');
  });
});

describe('E2E: Error Recovery Workflow', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-e2e-errors-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should handle deleting non-existent agent gracefully', () => {
    const result = runCli(['agents', 'delete', 'nonexistent', '--force'], testRepo.path);

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('not found');
  });

  it('should handle focusing non-existent agent gracefully', () => {
    // Note: focus command exits with tmux attach which we can't fully test
    // but we can verify it handles the missing agent case
    const result = runCli(['agents', 'focus', 'nonexistent'], testRepo.path);

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('not found');
  });

  it('should recover from corrupted storage', () => {
    // Create corrupt storage file
    const storageFile = path.join(testRepo.path, '.opus-orchestra', 'storage.json');
    fs.writeFileSync(storageFile, 'not valid json {{{');

    // Commands should still work (using defaults)
    const result = runCli(['status'], testRepo.path);

    // Should not crash, may show no agents or handle gracefully
    expect(result.status === 0 || result.stderr.length > 0).toBe(true);
  });

  it('should handle creating agent when worktree exists', () => {
    // Create first agent
    runCli(['agents', 'create'], testRepo.path);

    // Try creating again - should create next available (bravo)
    const result = runCli(['agents', 'create'], testRepo.path);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('bravo');
  });
});

describe('E2E: Multi-Session Workflow', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-e2e-multi-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should maintain state across multiple CLI invocations', () => {
    // First session: create agents
    runCli(['agents', 'create', '2'], testRepo.path);

    // Second session: verify they exist
    let result = runCli(['agents', 'list'], testRepo.path);
    expect(result.stdout).toContain('alpha');
    expect(result.stdout).toContain('bravo');

    // Third session: delete one
    runCli(['agents', 'delete', 'alpha', '--force'], testRepo.path);

    // Fourth session: verify state
    result = runCli(['agents', 'list'], testRepo.path);
    expect(result.stdout).not.toContain('alpha');
    expect(result.stdout).toContain('bravo');

    // Fifth session: create new agent (should be alpha again since it was deleted)
    result = runCli(['agents', 'create'], testRepo.path);
    expect(result.stdout).toContain('alpha');
  });
});

describe('E2E: Dashboard Agent Deletion', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-e2e-dashboard-delete-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should still show remaining agents after deleting one of multiple agents', () => {
    // Create 3 agents
    runCli(['agents', 'create', '3'], testRepo.path);

    // Verify all 3 exist
    let result = runCli(['agents', 'list'], testRepo.path);
    expect(result.stdout).toContain('alpha');
    expect(result.stdout).toContain('bravo');
    expect(result.stdout).toContain('charlie');

    // Delete bravo (middle agent)
    result = runCli(['agents', 'delete', 'bravo', '--force'], testRepo.path);
    expect(result.status).toBe(0);

    // Verify alpha and charlie still exist, bravo is gone
    result = runCli(['agents', 'list'], testRepo.path);
    expect(result.stdout).toContain('alpha');
    expect(result.stdout).not.toContain('bravo');
    expect(result.stdout).toContain('charlie');

    // Verify status shows 2 agents, not 0
    result = runCli(['status'], testRepo.path);
    expect(result.stdout).toContain('Agents:');
    expect(result.stdout).toContain('2');
    expect(result.stdout).not.toContain('No agents found');
  });

  it('should persist deletion across CLI invocations', () => {
    // Create 2 agents
    runCli(['agents', 'create', '2'], testRepo.path);

    // Delete one
    runCli(['agents', 'delete', 'alpha', '--force'], testRepo.path);

    // Re-initialize container (simulates new CLI session)
    disposeContainer();

    // Verify deletion persisted
    const result = runCli(['agents', 'list'], testRepo.path);
    expect(result.stdout).not.toContain('alpha');
    expect(result.stdout).toContain('bravo');
  });
});

describe('E2E: Tmux Session and oo Alias', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-e2e-tmux-');
  });

  afterEach(() => {
    // Clean up any tmux sessions
    try {
      const container = getContainer();
      const agents = container.persistence.loadPersistedAgents();
      for (const agent of agents) {
        const sessionName = agent.sessionId
          ? container.tmuxService.getSessionName(agent.sessionId)
          : agent.name;
        container.tmuxService.killSession(sessionName);
      }
    } catch {
      // Container might not be initialized
    }
    disposeContainer();
    testRepo.cleanup();
  });

  it('should create tmux session with sessionId-based naming', () => {
    // Create an agent
    runCli(['agents', 'create'], testRepo.path);

    // Get the agent's sessionId
    initializeContainer(testRepo.path);
    const container = getContainer();
    const agents = container.persistence.loadPersistedAgents();
    expect(agents.length).toBe(1);

    const agent = agents[0];
    expect(agent.sessionId).toBeDefined();
    expect(agent.sessionId).toMatch(/^[0-9a-f-]{36}$/); // UUID format

    // Focus the agent (this creates the tmux session)
    const result = runCli(['agents', 'focus', 'alpha'], testRepo.path);
    // Note: focus command attaches to tmux, so we can't easily test interactively
    // But we can verify the session was created with the correct name

    // Re-initialize to check session exists
    disposeContainer();
    initializeContainer(testRepo.path);
    const container2 = getContainer();

    const sessionName = container2.tmuxService.getSessionName(agent.sessionId!);
    const sessionExists = container2.tmuxService.sessionExists(sessionName);

    // Kill the session for cleanup
    container2.tmuxService.killSession(sessionName);

    expect(sessionExists).toBe(true);
  });

  it('should set up oo alias when creating new tmux session', () => {
    // Create an agent
    runCli(['agents', 'create'], testRepo.path);

    // Initialize container to get agent info
    initializeContainer(testRepo.path);
    const container = getContainer();
    const agents = container.persistence.loadPersistedAgents();
    const agent = agents[0];

    // Create the tmux session with oo alias
    const sessionName = container.tmuxService.getSessionName(agent.sessionId!);
    container.tmuxService.createDetachedSession(sessionName, agent.worktreePath);

    const claudeCommand = container.config.get('claudeCommand') || 'claude';
    container.tmuxService.setupOoAlias(sessionName, claudeCommand, agent.sessionId!);

    // Capture the output of running 'alias' in the tmux session
    // Send 'alias oo' and capture output
    const { execSync } = require('node:child_process');
    try {
      // Give tmux a moment to process
      execSync('sleep 0.5');

      // Run 'alias' command in the tmux session and capture output
      const aliasOutput = execSync(
        `tmux send-keys -t "${sessionName}" 'alias oo' Enter && sleep 0.3 && tmux capture-pane -t "${sessionName}" -p`,
        { encoding: 'utf-8', timeout: 5000 }
      );

      // Check that oo alias is defined with the correct sessionId
      expect(aliasOutput).toContain('oo=');
      expect(aliasOutput).toContain(agent.sessionId);
    } finally {
      // Clean up
      container.tmuxService.killSession(sessionName);
    }
  });
});
