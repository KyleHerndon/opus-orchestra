/**
 * CLI Integration Tests
 *
 * Tests the CLI commands against a real git repository.
 * Uses in-process command execution for speed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createTestRepoWithConfig,
  createWorktree,
  TestRepo,
} from './fixtures/testRepo.js';
import { disposeContainer } from '../services/ServiceContainer.js';
import { runCommand } from '../cli.js';

/**
 * Run CLI command in-process (fast).
 */
async function runCli(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; status: number }> {
  const result = await runCommand(args, cwd);
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.exitCode,
  };
}

describe('CLI Integration Tests', async () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-cli-test-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  describe('status command', async () => {
    it('should show "no agents" message when no agents exist', async () => {
      const result = await runCli(['status'], testRepo.path);

      expect(result.stdout).toContain('No agents found');
    });

    it('should list agents when they exist', async () => {
      // Create a worktree manually to simulate an agent
      createWorktree(testRepo.path, 'alpha', 'claude-alpha');

      // ARCHITECTURE: Worktree-only persistence - save agent metadata to worktree
      const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-alpha');
      const metadataDir = path.join(worktreePath, '.opus-orchestra');
      fs.mkdirSync(metadataDir, { recursive: true });
      fs.writeFileSync(
        path.join(metadataDir, 'agent.json'),
        JSON.stringify({
          id: 1,
          name: 'alpha',
          sessionId: 'test-session-123',
          branch: 'claude-alpha',
          worktreePath,
          repoPath: testRepo.path,
          containerConfigName: 'unisolated',
        })
      );

      const result = await runCli(['status'], testRepo.path);

      expect(result.stdout).toContain('alpha');
      expect(result.stdout).toContain('Agents:');
    });
  });

  describe('agents list command', async () => {
    it('should show "no agents" when none exist', async () => {
      const result = await runCli(['agents', 'list'], testRepo.path);

      expect(result.stdout).toContain('No agents found');
    });

    it('should list agents with basic info', async () => {
      // Set up an agent
      createWorktree(testRepo.path, 'bravo', 'claude-bravo');

      // ARCHITECTURE: Worktree-only persistence - save agent metadata to worktree
      const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-bravo');
      const metadataDir = path.join(worktreePath, '.opus-orchestra');
      fs.mkdirSync(metadataDir, { recursive: true });
      fs.writeFileSync(
        path.join(metadataDir, 'agent.json'),
        JSON.stringify({
          id: 1,
          name: 'bravo',
          sessionId: 'test-session-123',
          branch: 'claude-bravo',
          worktreePath,
          repoPath: testRepo.path,
        })
      );

      const result = await runCli(['agents', 'list'], testRepo.path);

      expect(result.stdout).toContain('bravo');
    });

    it('should show verbose info with --verbose flag', async () => {
      createWorktree(testRepo.path, 'charlie', 'claude-charlie');

      // ARCHITECTURE: Worktree-only persistence - save agent metadata to worktree
      const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-charlie');
      const metadataDir = path.join(worktreePath, '.opus-orchestra');
      fs.mkdirSync(metadataDir, { recursive: true });
      fs.writeFileSync(
        path.join(metadataDir, 'agent.json'),
        JSON.stringify({
          id: 1,
          name: 'charlie',
          sessionId: 'test-session-123',
          branch: 'claude-charlie',
          worktreePath,
          repoPath: testRepo.path,
          containerConfigName: 'unisolated',
        })
      );

      const result = await runCli(['agents', 'list', '--verbose'], testRepo.path);

      expect(result.stdout).toContain('charlie');
      expect(result.stdout).toContain('Branch:');
      expect(result.stdout).toContain('claude-charlie');
    });
  });

  describe('agents create command', async () => {
    it('should create a single agent by default', async () => {
      const result = await runCli(['agents', 'create'], testRepo.path);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Creating');
      expect(result.stdout).toContain('Created 1 agent');

      // Verify worktree was created
      const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-alpha');
      expect(fs.existsSync(worktreePath)).toBe(true);
    });

    it('should create multiple agents when count specified', async () => {
      const result = await runCli(['agents', 'create', '2'], testRepo.path);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Created 2 agent');

      // Verify worktrees were created
      expect(fs.existsSync(path.join(testRepo.path, '.worktrees', 'claude-alpha'))).toBe(true);
      expect(fs.existsSync(path.join(testRepo.path, '.worktrees', 'claude-bravo'))).toBe(true);
    });

    it('should reject invalid count', async () => {
      const result = await runCli(['agents', 'create', '101'], testRepo.path);

      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toContain('between 1 and 100');
    });

    it('should skip existing agents', async () => {
      // Create first agent
      await runCli(['agents', 'create'], testRepo.path);

      // Try to create more - should use next available name
      const result = await runCli(['agents', 'create'], testRepo.path);

      expect(result.status).toBe(0);
      // Should create 'bravo' since 'alpha' exists
      expect(result.stdout).toContain('bravo');
    });
  });

  describe('config show command', async () => {
    it('should display configuration values', async () => {
      const result = await runCli(['config', 'show'], testRepo.path);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Configuration');
      expect(result.stdout).toContain('useTmux');
      expect(result.stdout).toContain('defaultAgentCount');
      expect(result.stdout).toContain('worktreeDirectory');
    });
  });

  describe('config set command', async () => {
    it('should set a numeric config value', async () => {
      const result = await runCli(['config', 'set', 'defaultAgentCount', '5'], testRepo.path);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Set defaultAgentCount = 5');
    });

    it('should set a boolean config value', async () => {
      const result = await runCli(['config', 'set', 'useTmux', 'false'], testRepo.path);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Set useTmux = false');
    });

    it('should reject unknown config key', async () => {
      const result = await runCli(['config', 'set', 'unknownKey', 'value'], testRepo.path);

      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toContain('Unknown configuration key');
    });
  });

  describe('agents delete command', async () => {
    it('should fail when agent does not exist', async () => {
      const result = await runCli(['agents', 'delete', 'nonexistent', '--force'], testRepo.path);

      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toContain('not found');
    });

    it('should delete agent with --force flag', async () => {
      // First create an agent
      await runCli(['agents', 'create'], testRepo.path);

      // Verify it exists
      const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-alpha');
      expect(fs.existsSync(worktreePath)).toBe(true);

      // Delete with force
      const result = await runCli(['agents', 'delete', 'alpha', '--force'], testRepo.path);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('deleted');

      // Verify worktree is gone
      expect(fs.existsSync(worktreePath)).toBe(false);
    });
  });
});

describe('Tmux Session Management', async () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-tmux-test-');
  });

  afterEach(() => {
    // Clean up any tmux sessions we created
    try {
      spawnSync('tmux', ['kill-session', '-t', 'alpha'], { stdio: 'ignore' });
    } catch {
      // Ignore - session may not exist
    }
    disposeContainer();
    testRepo.cleanup();
  });

  it('should recreate tmux session after it is killed', async () => {
    // Skip if tmux is not available
    const tmuxCheck = spawnSync('which', ['tmux'], { encoding: 'utf-8' });
    if (tmuxCheck.status !== 0) {
      console.log('Skipping tmux test - tmux not available');
      return;
    }

    // Create an agent
    await runCli(['agents', 'create'], testRepo.path);

    // Verify agent was created
    const listResult = await runCli(['agents', 'list'], testRepo.path);
    expect(listResult.stdout).toContain('alpha');

    // Create a tmux session for the agent (simulating first focus)
    const sessionName = 'alpha';
    spawnSync('tmux', ['new-session', '-d', '-s', sessionName, '-c', testRepo.path], {
      stdio: 'ignore',
    });

    // Verify session exists
    const hasSession1 = spawnSync('tmux', ['has-session', '-t', sessionName], {
      stdio: 'ignore',
    });
    expect(hasSession1.status).toBe(0);

    // Kill the session (simulating Ctrl+D closing the shell)
    spawnSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore' });

    // Verify session is gone
    const hasSession2 = spawnSync('tmux', ['has-session', '-t', sessionName], {
      stdio: 'ignore',
    });
    expect(hasSession2.status).not.toBe(0);

    // Now test that `tmux new-session -A` recreates it
    // This is what attachToAgentSession uses
    const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-alpha');
    const recreate = spawnSync(
      'tmux',
      ['new-session', '-A', '-d', '-s', sessionName, '-c', worktreePath],
      { stdio: 'ignore' }
    );
    expect(recreate.status).toBe(0);

    // Verify session exists again
    const hasSession3 = spawnSync('tmux', ['has-session', '-t', sessionName], {
      stdio: 'ignore',
    });
    expect(hasSession3.status).toBe(0);

    // Clean up
    spawnSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore' });
  });
});

describe('CLI Error Handling', async () => {
  it('should show help on unknown command', async () => {
    const result = await runCli(['unknowncommand'], process.cwd());

    // Commander shows help or error for unknown commands
    expect(result.stderr + result.stdout).toBeTruthy();
  });

  it('should show version with --version', async () => {
    const result = await runCli(['--version'], process.cwd());

    expect(result.stdout).toContain('0.2.0');
  });

  it('should show help with --help', async () => {
    const result = await runCli(['--help'], process.cwd());

    expect(result.stdout).toContain('opus-orchestra');
    expect(result.stdout).toContain('dashboard');
    expect(result.stdout).toContain('status');
    expect(result.stdout).toContain('agents');
  });
});
