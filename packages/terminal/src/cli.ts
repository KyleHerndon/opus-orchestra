/**
 * CLI entry point using Commander.js
 */

import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import chalk from 'chalk';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { App } from './components/App.js';
import {
  initializeContainer,
  disposeContainer,
  isContainerInitialized,
  getContainer,
} from './services/ServiceContainer.js';
import { getAvailableNames } from '@opus-orchestra/core';

const program = new Command();

program
  .name('opus-orchestra')
  .description('Terminal UI for Opus Orchestra - manage Claude Code agents')
  .version('0.2.0')
  .exitOverride() // Throw instead of process.exit() - enables testing
  .configureOutput({
    writeOut: (str) => process.stdout.write(str),
    writeErr: (str) => process.stderr.write(str),
  });

/**
 * Initialize the ServiceContainer for the current working directory.
 */
function ensureContainer(): void {
  if (!isContainerInitialized()) {
    initializeContainer(getEffectiveCwd());
  }
}

// Session naming is handled by TmuxService.getAgentSessionName() - single source of truth

// Default command: interactive dashboard
program
  .command('dashboard', { isDefault: true })
  .description('Open interactive dashboard (default)')
  .action(async () => {
    ensureContainer();
    await runDashboardLoop();
    disposeContainer();
  });

interface DashboardState {
  focusAgent: string | null;
}

/**
 * Attach to a tmux session for an agent.
 * Creates the session if it doesn't exist and sets up the oo alias.
 * Uses sessionId-based naming for stability across agent renames.
 */
function attachToAgentSession(agentName: string): void {
  const container = getContainer();

  // Get agent from storage
  const agents = container.persistence.loadPersistedAgents();
  const agent = agents.find((a: { name: string }) => a.name === agentName);

  if (!agent) {
    console.error(chalk.red(`Agent "${agentName}" not found in storage.`));
    return;
  }

  // Use sessionId-based naming for stability across renames
  const sessionName = container.tmuxService.getAgentSessionName(agent);

  // Clear screen and show hint
  console.clear();
  console.log(chalk.blue(`Attaching to ${agentName}...`));
  console.log(chalk.dim('(Press Ctrl+B, D to detach and return to dashboard)\n'));

  // Use atomic create-or-attach: createDetachedSession uses -A -d flags
  // which creates the session if it doesn't exist, or does nothing if it does.
  // This eliminates the race condition between checking and creating.
  const sessionExistedBefore = container.tmuxService.sessionExists(sessionName);
  container.tmuxService.createDetachedSession(sessionName, agent.worktreePath);

  // Set up oo alias only for newly created sessions
  if (!sessionExistedBefore) {
    const claudeCommand = container.config.get('claudeCommand') || 'claude';
    const sessionIdForAlias = agent.sessionId || agent.name;
    container.tmuxService.setupOoAlias(sessionName, claudeCommand, sessionIdForAlias);
  }

  // Attach to the session
  spawnSync('tmux', ['attach-session', '-t', sessionName], {
    stdio: 'inherit',
  });

  // Clear screen before returning to dashboard
  console.clear();
}

/**
 * Run the dashboard in a loop, returning after tmux detach.
 */
async function runDashboardLoop(): Promise<void> {
  // State to track focus request from dashboard
  const state: DashboardState = { focusAgent: null };

  // eslint-disable-next-line no-constant-condition -- intentional infinite loop with break
  while (true) {
    // Reset focus state
    state.focusAgent = null;

    // Callback to capture focus request
    const handleFocus = (name: string): void => {
      state.focusAgent = name;
    };

    // Render dashboard
    const { waitUntilExit } = render(
      React.createElement(App, {
        onFocusAgent: handleFocus,
      })
    );

    // Wait for dashboard to exit
    await waitUntilExit();

    // If user focused an agent, attach to tmux
    if (state.focusAgent !== null) {
      const agentToFocus = state.focusAgent;
      attachToAgentSession(agentToFocus);
      // Loop back to dashboard
      continue;
    }

    // User quit normally (pressed 'q')
    break;
  }
}

// Status command: quick non-interactive status
program
  .command('status')
  .description('Show quick status summary')
  .action(async () => {
    ensureContainer();
    const container = getContainer();

    try {
      const agents = container.persistence.loadPersistedAgents();

      if (agents.length === 0) {
        console.log(chalk.yellow('No agents found.'));
        console.log(chalk.dim('Run `opus-orchestra agents create` to create agents.'));
        return;
      }

      console.log(chalk.bold.blue('Opus Orchestra Status'));
      console.log(chalk.dim('─'.repeat(40)));
      console.log(`${chalk.cyan('Agents:')} ${agents.length}`);

      // Count sessions
      let activeSessions = 0;
      for (const agent of agents) {
        const sessionName = container.tmuxService.getAgentSessionName(agent);
        if (container.tmuxService.sessionExists(sessionName)) {
          activeSessions++;
        }
      }
      console.log(`${chalk.cyan('Active tmux sessions:')} ${activeSessions}`);
      console.log(chalk.dim('─'.repeat(40)));

      // List agents briefly
      for (const agent of agents) {
        const sessionName = container.tmuxService.getAgentSessionName(agent);
        const hasSession = container.tmuxService.sessionExists(sessionName);
        const status = hasSession ? chalk.green('●') : chalk.dim('○');
        console.log(`  ${status} ${chalk.bold(agent.name)} (${agent.branch})`);
      }

      console.log();
      console.log(chalk.dim('Run `opus-orchestra` for interactive dashboard.'));
    } finally {
      disposeContainer();
    }
  });

// Agents subcommands
const agents = program.command('agents').description('Agent management commands');

agents
  .command('list')
  .description('List all agents')
  .option('-v, --verbose', 'Show detailed information')
  .action(async (options) => {
    ensureContainer();
    const container = getContainer();

    try {
      const agentList = container.persistence.loadPersistedAgents();

      if (agentList.length === 0) {
        console.log(chalk.yellow('No agents found.'));
        return;
      }

      console.log(chalk.bold.blue('Agents'));
      console.log();

      for (const agent of agentList) {
        const sessionName = container.tmuxService.getAgentSessionName(agent);
        const hasSession = container.tmuxService.sessionExists(sessionName);
        const status = hasSession ? chalk.green('active') : chalk.dim('inactive');

        console.log(`${chalk.bold(agent.name)} ${chalk.dim(`(${status})`)}`);

        if (options.verbose) {
          console.log(`  ${chalk.dim('Branch:')} ${agent.branch}`);
          console.log(`  ${chalk.dim('Path:')} ${agent.worktreePath}`);
          console.log(`  ${chalk.dim('Container:')} ${agent.containerConfigName || 'unisolated'}`);
          console.log();
        }
      }

      if (!options.verbose) {
        console.log();
        console.log(chalk.dim('Use --verbose for more details.'));
      }
    } finally {
      disposeContainer();
    }
  });

agents
  .command('create')
  .description('Create new agents')
  .argument('[count]', 'Number of agents to create', '1')
  .option('-c, --container <name>', 'Container config to use', 'unisolated')
  .action(async (countStr: string, options) => {
    ensureContainer();
    const container = getContainer();

    try {
      // Use Number() instead of parseInt() because parseInt('5abc', 10) returns 5
      // while Number('5abc') returns NaN - we want strict validation
      const count = Number(countStr);
      if (!Number.isInteger(count) || count < 1 || count > 100) {
        console.error(chalk.red('Count must be a whole number between 1 and 100.'));
        process.exit(1);
      }

      const repoPath = getEffectiveCwd();
      const baseBranch = await container.gitService.getBaseBranch(repoPath);

      // Get existing agent names from persistence and worktree directories
      const existing = container.persistence.loadPersistedAgents();
      const usedNames = new Set(existing.map((a) => a.name));

      // Also check for existing worktree directories (orphaned worktrees)
      for (const name of usedNames) {
        const worktreePath = container.worktreeManager.getWorktreePath(repoPath, name);
        if (container.worktreeManager.worktreeExists(worktreePath)) {
          usedNames.add(name);
        }
      }

      // Use name generator that supports unlimited names (alpha, bravo, ..., alpha-alpha, etc.)
      const availableNames = getAvailableNames(usedNames, count);

      if (availableNames.length < count) {
        console.error(chalk.red(`Could only generate ${availableNames.length} agent names.`));
        process.exit(1);
      }

      console.log(chalk.blue(`Creating ${count} agent(s)...`));

      // Generate starting ID (max existing ID + 1)
      const maxExistingId = existing.length > 0
        ? Math.max(...existing.map((a) => a.id || 0))
        : 0;

      // Collect created agents for persistence
      const createdAgents: Array<{
        id: number;
        name: string;
        sessionId: string;
        branch: string;
        worktreePath: string;
        repoPath: string;
        taskFile: string | null;
        containerConfigName: string;
      }> = [];

      for (let i = 0; i < count; i++) {
        const name = availableNames[i];
        const branch = `claude-${name}`;
        const worktreePath = container.worktreeManager.getWorktreePath(repoPath, name);

        console.log(`  Creating ${chalk.bold(name)}...`);

        // Create worktree (skip if already exists)
        if (!container.worktreeManager.worktreeExists(worktreePath)) {
          container.worktreeManager.createWorktree(
            repoPath,
            worktreePath,
            branch,
            baseBranch
          );
        }

        // Create agent data (matching PersistedAgent interface)
        const agentData = {
          id: maxExistingId + 1 + i,
          name,
          sessionId: randomUUID(),
          branch,
          worktreePath,
          repoPath,
          taskFile: null,
          containerConfigName: options.container || 'unisolated',
        };

        createdAgents.push(agentData);

        // Create full agent object for coordination files and metadata
        const agentForSetup = {
          ...agentData,
          terminal: null,
          status: 'idle' as const,
          statusIcon: 'circle-outline' as const,
          pendingApproval: null,
          lastInteractionTime: new Date(),
          diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
          todos: [],
        };

        // Copy coordination files (hooks, commands, scripts) from core
        container.worktreeManager.copyCoordinationFiles(agentForSetup);

        // Save agent metadata to worktree (.opus-orchestra/agent.json)
        // This enables restoration and scanning of worktrees
        container.worktreeManager.saveAgentMetadata(agentForSetup);

        console.log(chalk.green(`  ✓ ${name} created (${branch})`));
      }

      // Agent metadata is already saved to worktree via saveAgentMetadata()
      // No central storage is used - worktree metadata is the source of truth

      console.log();
      console.log(chalk.green(`Created ${count} agent(s).`));
      console.log(chalk.dim('Run `opus-orchestra` to manage agents interactively.'));
    } catch (err) {
      console.error(chalk.red('Failed to create agents:'), err);
      process.exit(1);
    } finally {
      disposeContainer();
    }
  });

agents
  .command('focus')
  .description('Focus an agent terminal (attach to tmux session)')
  .argument('<name>', 'Agent name to focus')
  .action(async (name: string) => {
    ensureContainer();
    const container = getContainer();

    try {
      const agentList = container.persistence.loadPersistedAgents();
      const agent = agentList.find((a) => a.name === name);

      if (!agent) {
        console.error(chalk.red(`Agent "${name}" not found.`));
        console.log(chalk.dim('Available agents:'));
        for (const a of agentList) {
          console.log(`  - ${a.name}`);
        }
        process.exit(1);
      }

      const sessionName = container.tmuxService.getAgentSessionName(agent);

      // Use atomic create-or-attach to avoid race conditions
      const sessionExistedBefore = container.tmuxService.sessionExists(sessionName);
      if (!sessionExistedBefore) {
        console.log(chalk.yellow(`No active tmux session for "${name}".`));
        console.log(chalk.dim('Starting a new session...'));
      }

      // Create session if needed (atomic operation with -A -d flags)
      container.tmuxService.createDetachedSession(sessionName, agent.worktreePath);

      // Set up oo alias only for newly created sessions
      if (!sessionExistedBefore) {
        const claudeCommand = container.config.get('claudeCommand') || 'claude';
        const sessionIdForAlias = agent.sessionId || agent.name;
        container.tmuxService.setupOoAlias(sessionName, claudeCommand, sessionIdForAlias);
      }

      console.log(chalk.blue(`Attaching to ${name}...`));
      console.log(chalk.dim('(Press Ctrl+B, D to detach and return)'));

      // In test mode, skip actual tmux attach
      if (testCwd !== null) {
        disposeContainer();
        return;
      }

      // Attach to session - this replaces current process
      const { spawn } = await import('node:child_process');
      const child = spawn('tmux', ['attach-session', '-t', sessionName], {
        stdio: 'inherit',
      });

      child.on('error', (err) => {
        // Spawn itself failed (e.g., tmux not found)
        console.error(chalk.red(`Failed to spawn tmux: ${err.message}`));
        console.error(chalk.dim('Make sure tmux is installed and available in PATH.'));
        disposeContainer();
        process.exit(1);
      });

      child.on('exit', (code, signal) => {
        if (signal) {
          // Process was killed by signal
          disposeContainer();
          process.exit(128 + (signal === 'SIGTERM' ? 15 : signal === 'SIGKILL' ? 9 : 1));
        }
        disposeContainer();
        process.exit(code ?? 0);
      });
    } catch (err) {
      console.error(chalk.red('Failed to focus agent:'), err);
      disposeContainer();
      process.exit(1);
    }
  });

agents
  .command('delete')
  .description('Delete an agent')
  .argument('<name>', 'Agent name to delete')
  .option('-f, --force', 'Skip confirmation')
  .action(async (name: string, options) => {
    ensureContainer();
    const container = getContainer();

    try {
      const agentList = container.persistence.loadPersistedAgents();
      const agent = agentList.find((a) => a.name === name);

      if (!agent) {
        console.error(chalk.red(`Agent "${name}" not found.`));
        process.exit(1);
      }

      if (!options.force) {
        console.log(chalk.yellow(`This will delete agent "${name}" and its worktree.`));
        console.log(chalk.dim('Use --force to skip this warning.'));

        // Simple confirmation using readline
        const readline = await import('node:readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question('Continue? (y/N) ', resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          console.log('Cancelled.');
          process.exit(0);
        }
      }

      console.log(chalk.blue(`Deleting ${name}...`));

      // Kill tmux session if exists (use consistent session naming)
      const sessionName = container.tmuxService.getAgentSessionName(agent);
      container.tmuxService.killSession(sessionName);

      // Remove worktree (agent metadata is stored there, so this removes all state)
      container.worktreeManager.removeWorktree(
        agent.repoPath,
        agent.worktreePath,
        agent.branch
      );

      // No central storage to update - worktree deletion removes all agent state

      console.log(chalk.green(`✓ Agent "${name}" deleted.`));
    } catch (err) {
      console.error(chalk.red('Failed to delete agent:'), err);
      process.exit(1);
    } finally {
      disposeContainer();
    }
  });

// Config subcommands
const config = program.command('config').description('Configuration commands');

config
  .command('show')
  .description('Show current configuration')
  .action(() => {
    ensureContainer();
    const container = getContainer();

    try {
      const allConfig = container.config.getAll();

      console.log(chalk.bold.blue('Configuration'));
      console.log();

      for (const [key, value] of Object.entries(allConfig)) {
        const formattedValue = typeof value === 'boolean'
          ? (value ? chalk.green('true') : chalk.red('false'))
          : chalk.cyan(String(value));
        console.log(`  ${chalk.dim(key + ':')} ${formattedValue}`);
      }

      console.log();
      console.log(chalk.dim('Use `opus-orchestra config set <key> <value>` to change values.'));
    } finally {
      disposeContainer();
    }
  });

config
  .command('set')
  .description('Set a configuration value')
  .argument('<key>', 'Configuration key')
  .argument('<value>', 'Configuration value')
  .action(async (key: string, value: string) => {
    ensureContainer();
    const container = getContainer();

    try {
      const allConfig = container.config.getAll();

      if (!(key in allConfig)) {
        console.error(chalk.red(`Unknown configuration key: ${key}`));
        console.log(chalk.dim('Available keys:'));
        for (const k of Object.keys(allConfig)) {
          console.log(`  - ${k}`);
        }
        process.exit(1);
      }

      // Parse value based on current type
      const currentValue = allConfig[key as keyof typeof allConfig];
      let parsedValue: unknown;

      if (typeof currentValue === 'boolean') {
        parsedValue = value === 'true' || value === '1';
      } else if (typeof currentValue === 'number') {
        parsedValue = parseInt(value, 10);
        if (isNaN(parsedValue as number)) {
          console.error(chalk.red(`Invalid number: ${value}`));
          process.exit(1);
        }
      } else {
        parsedValue = value;
      }

      await container.config.update(key as keyof typeof allConfig, parsedValue as never);
      console.log(chalk.green(`✓ Set ${key} = ${parsedValue}`));
    } catch (err) {
      console.error(chalk.red('Failed to set config:'), err);
      process.exit(1);
    } finally {
      disposeContainer();
    }
  });

export function run(): void {
  program.parse();
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Store test cwd for in-process testing
let testCwd: string | null = null;

/**
 * Get the effective working directory.
 * Uses testCwd if set (for testing), otherwise process.cwd().
 */
export function getEffectiveCwd(): string {
  return testCwd || process.cwd();
}

/**
 * Run CLI command programmatically (for testing).
 * Captures output and returns result instead of writing to console.
 */
export async function runCommand(args: string[], cwd?: string): Promise<CommandResult> {
  const originalArgv = process.argv;
  const stdout: string[] = [];
  const stderr: string[] = [];

  // Capture console output
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...logArgs) => stdout.push(logArgs.map(String).join(' '));
  console.error = (...logArgs) => stderr.push(logArgs.map(String).join(' '));

  // Capture Commander's configured output (for --help, --version)
  program.configureOutput({
    writeOut: (str) => stdout.push(str.trimEnd()),
    writeErr: (str) => stderr.push(str.trimEnd()),
  });

  let exitCode = 0;

  try {
    // Set test cwd instead of chdir (works in worker threads)
    testCwd = cwd || null;

    if (isContainerInitialized()) {
      disposeContainer();
    }

    process.argv = ['node', 'opus', ...args];
    await program.parseAsync(process.argv);
  } catch (err: unknown) {
    // Commander throws on exitOverride - extract exit code
    if (err && typeof err === 'object' && 'exitCode' in err) {
      exitCode = (err as { exitCode: number }).exitCode;
    } else {
      exitCode = 1;
      stderr.push(String(err));
    }
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.argv = originalArgv;
    testCwd = null;
    disposeContainer();

    // Restore original output configuration
    program.configureOutput({
      writeOut: (str) => process.stdout.write(str),
      writeErr: (str) => process.stderr.write(str),
    });
  }

  return {
    stdout: stdout.join('\n'),
    stderr: stderr.join('\n'),
    exitCode,
  };
}

// Export program for advanced testing scenarios
export { program };
