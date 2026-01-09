/**
 * CLI Integration Tests
 *
 * Tests the CLI commands against a real git repository.
 * These are integration tests that verify the full command flow.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createTestRepoWithConfig,
  createWorktree,
  TestRepo,
  makeUncommittedChange,
} from './fixtures/testRepo.js';
import {
  initializeContainer,
  disposeContainer,
  getContainer,
} from '../services/ServiceContainer.js';

// Path to the compiled CLI entry point (built by npm run build)
const CLI_PATH = path.resolve(__dirname, '../../dist/bin/opus.js');

/**
 * Run CLI command using node and capture output.
 */
function runCli(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      // Force non-interactive mode
      FORCE_COLOR: '0',
      CI: 'true',
    },
    timeout: 30000,
  });

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? 1,
  };
}

describe('CLI Integration Tests', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-cli-test-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  describe('status command', () => {
    it('should show "no agents" message when no agents exist', () => {
      const result = runCli(['status'], testRepo.path);

      expect(result.stdout).toContain('No agents found');
    });

    it('should list agents when they exist', () => {
      // Create a worktree manually to simulate an agent
      createWorktree(testRepo.path, 'alpha', 'claude-alpha');

      // Create the persistence file using conf's nested format
      const configDir = path.join(testRepo.path, '.opus-orchestra');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'storage.json'),
        JSON.stringify({
          opus: {
            agents: [
              {
                name: 'alpha',
                branch: 'claude-alpha',
                worktreePath: path.join(testRepo.path, '.worktrees', 'claude-alpha'),
                repoPath: testRepo.path,
                containerConfigName: 'unisolated',
              },
            ],
          },
        })
      );

      const result = runCli(['status'], testRepo.path);

      expect(result.stdout).toContain('alpha');
      expect(result.stdout).toContain('Agents:');
    });
  });

  describe('agents list command', () => {
    it('should show "no agents" when none exist', () => {
      const result = runCli(['agents', 'list'], testRepo.path);

      expect(result.stdout).toContain('No agents found');
    });

    it('should list agents with basic info', () => {
      // Set up an agent
      createWorktree(testRepo.path, 'bravo', 'claude-bravo');
      const configDir = path.join(testRepo.path, '.opus-orchestra');
      fs.writeFileSync(
        path.join(configDir, 'storage.json'),
        JSON.stringify({
          opus: {
            agents: [
              {
                name: 'bravo',
                branch: 'claude-bravo',
                worktreePath: path.join(testRepo.path, '.worktrees', 'claude-bravo'),
                repoPath: testRepo.path,
              },
            ],
          },
        })
      );

      const result = runCli(['agents', 'list'], testRepo.path);

      expect(result.stdout).toContain('bravo');
    });

    it('should show verbose info with --verbose flag', () => {
      createWorktree(testRepo.path, 'charlie', 'claude-charlie');
      const configDir = path.join(testRepo.path, '.opus-orchestra');
      fs.writeFileSync(
        path.join(configDir, 'storage.json'),
        JSON.stringify({
          opus: {
            agents: [
              {
                name: 'charlie',
                branch: 'claude-charlie',
                worktreePath: path.join(testRepo.path, '.worktrees', 'claude-charlie'),
                repoPath: testRepo.path,
                containerConfigName: 'unisolated',
              },
            ],
          },
        })
      );

      const result = runCli(['agents', 'list', '--verbose'], testRepo.path);

      expect(result.stdout).toContain('charlie');
      expect(result.stdout).toContain('Branch:');
      expect(result.stdout).toContain('claude-charlie');
    });
  });

  describe('agents create command', () => {
    it('should create a single agent by default', () => {
      const result = runCli(['agents', 'create'], testRepo.path);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Creating');
      expect(result.stdout).toContain('Created 1 agent');

      // Verify worktree was created
      const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-alpha');
      expect(fs.existsSync(worktreePath)).toBe(true);
    });

    it('should create multiple agents when count specified', () => {
      const result = runCli(['agents', 'create', '2'], testRepo.path);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Created 2 agent');

      // Verify worktrees were created
      expect(fs.existsSync(path.join(testRepo.path, '.worktrees', 'claude-alpha'))).toBe(true);
      expect(fs.existsSync(path.join(testRepo.path, '.worktrees', 'claude-bravo'))).toBe(true);
    });

    it('should reject invalid count', () => {
      const result = runCli(['agents', 'create', '100'], testRepo.path);

      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toContain('between 1 and 10');
    });

    it('should skip existing agents', () => {
      // Create first agent
      runCli(['agents', 'create'], testRepo.path);

      // Try to create more - should use next available name
      const result = runCli(['agents', 'create'], testRepo.path);

      expect(result.status).toBe(0);
      // Should create 'bravo' since 'alpha' exists
      expect(result.stdout).toContain('bravo');
    });
  });

  describe('config show command', () => {
    it('should display configuration values', () => {
      const result = runCli(['config', 'show'], testRepo.path);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Configuration');
      expect(result.stdout).toContain('useTmux');
      expect(result.stdout).toContain('defaultAgentCount');
      expect(result.stdout).toContain('worktreeDirectory');
    });
  });

  describe('config set command', () => {
    it('should set a numeric config value', () => {
      const result = runCli(['config', 'set', 'defaultAgentCount', '5'], testRepo.path);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Set defaultAgentCount = 5');
    });

    it('should set a boolean config value', () => {
      const result = runCli(['config', 'set', 'useTmux', 'false'], testRepo.path);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Set useTmux = false');
    });

    it('should reject unknown config key', () => {
      const result = runCli(['config', 'set', 'unknownKey', 'value'], testRepo.path);

      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toContain('Unknown configuration key');
    });
  });

  describe('agents delete command', () => {
    it('should fail when agent does not exist', () => {
      const result = runCli(['agents', 'delete', 'nonexistent', '--force'], testRepo.path);

      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toContain('not found');
    });

    it('should delete agent with --force flag', () => {
      // First create an agent
      runCli(['agents', 'create'], testRepo.path);

      // Verify it exists
      const worktreePath = path.join(testRepo.path, '.worktrees', 'claude-alpha');
      expect(fs.existsSync(worktreePath)).toBe(true);

      // Delete with force
      const result = runCli(['agents', 'delete', 'alpha', '--force'], testRepo.path);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('deleted');

      // Verify worktree is gone
      expect(fs.existsSync(worktreePath)).toBe(false);
    });
  });
});

describe('Tmux Session Management', () => {
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

  it('should recreate tmux session after it is killed', () => {
    // Skip if tmux is not available
    const tmuxCheck = spawnSync('which', ['tmux'], { encoding: 'utf-8' });
    if (tmuxCheck.status !== 0) {
      console.log('Skipping tmux test - tmux not available');
      return;
    }

    // Create an agent
    runCli(['agents', 'create'], testRepo.path);

    // Verify agent was created
    const listResult = runCli(['agents', 'list'], testRepo.path);
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

describe('CLI Error Handling', () => {
  it('should show help on unknown command', () => {
    const result = spawnSync('node', [CLI_PATH, 'unknowncommand'], {
      encoding: 'utf-8',
      timeout: 10000,
    });

    // Commander shows help or error for unknown commands
    expect(result.stderr + result.stdout).toBeTruthy();
  });

  it('should show version with --version', () => {
    const result = spawnSync('node', [CLI_PATH, '--version'], {
      encoding: 'utf-8',
      timeout: 10000,
    });

    expect(result.stdout).toContain('0.2.0');
  });

  it('should show help with --help', () => {
    const result = spawnSync('node', [CLI_PATH, '--help'], {
      encoding: 'utf-8',
      timeout: 10000,
    });

    expect(result.stdout).toContain('opus-orchestra');
    expect(result.stdout).toContain('dashboard');
    expect(result.stdout).toContain('status');
    expect(result.stdout).toContain('agents');
  });
});
