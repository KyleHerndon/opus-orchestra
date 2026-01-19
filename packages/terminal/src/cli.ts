/**
 * CLI entry point using Commander.js
 */

import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import chalk from 'chalk';
import { spawnSync } from 'node:child_process';
import { App } from './components/App.js';
import {
  initializeContainer,
  disposeContainer,
  isContainerInitialized,
  getContainer,
} from './services/ServiceContainer.js';
import { output, outputError, clearScreen, captureOutput } from './io/CliOutput.js';

/**
 * Synchronous sleep - waits for the specified milliseconds.
 * Used to allow shell initialization in tmux sessions before sending commands.
 */
function sleepSync(ms: number): void {
  const seconds = ms / 1000;
  spawnSync('sleep', [seconds.toString()]);
}

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

/**
 * Dashboard controller - manages communication between CLI and React App.
 * Allows the dashboard to signal focus requests and the CLI to signal resume.
 */
interface DashboardController {
  // Called by App when user wants to focus an agent
  requestFocus: (agentName: string) => void;
  // Called by App when user quits
  requestQuit: () => void;
  // Promise that App awaits - resolves when tmux detaches and dashboard should resume
  waitForResume: () => Promise<void>;
  // Check if dashboard should quit
  shouldQuit: () => boolean;
}

function createDashboardController(): DashboardController {
  let focusedAgent: string | null = null;
  let quitRequested = false;

  return {
    requestFocus: (agentName: string) => {
      focusedAgent = agentName;
    },
    requestQuit: () => {
      quitRequested = true;
    },
    waitForResume: () => {
      return new Promise((resolve) => {
        // Defer the blocking tmux attach to next tick
        // This ensures React has rendered null (clearing Ink output) first
        setImmediate(() => {
          if (focusedAgent) {
            const agent = focusedAgent;
            focusedAgent = null;
            // This blocks until user detaches from tmux
            attachToAgentSession(agent);
          }
          resolve();
        });
      });
    },
    shouldQuit: () => quitRequested,
  };
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
    container.logger?.error(`Agent "${agentName}" not found in storage`);
    return;
  }

  // Use sessionId-based naming for stability across renames
  const sessionName = container.tmuxService.getAgentSessionName(agent);

  // Clear screen before attaching to tmux
  clearScreen();

  // Use atomic create-or-attach: createDetachedSession uses -A -d flags
  // which creates the session if it doesn't exist, or does nothing if it does.
  // This eliminates the race condition between checking and creating.
  const sessionExistedBefore = container.tmuxService.sessionExists(sessionName);
  container.tmuxService.createDetachedSession(sessionName, agent.worktreePath);

  // Set up oo alias only for newly created sessions
  if (!sessionExistedBefore) {
    // Wait for shell to initialize in the new tmux session (VS Code uses 200ms)
    sleepSync(200);
    const claudeCommand = container.config.get('claudeCommand') || 'claude';
    const sessionIdForAlias = agent.sessionId || agent.name;
    container.tmuxService.setupOoAlias(sessionName, claudeCommand, sessionIdForAlias);
  }

  // Attach to the session (blocks until user detaches)
  spawnSync('tmux', ['attach-session', '-t', sessionName], {
    stdio: 'inherit',
  });

  // Clear screen before returning to dashboard
  clearScreen();
}

/**
 * Run the dashboard, keeping it mounted in background during tmux attach.
 * The dashboard state (agents, polling, etc.) persists across focus/return cycles.
 */
async function runDashboardLoop(): Promise<void> {
  const controller = createDashboardController();

  // Render dashboard once - it stays mounted for the entire session
  const { waitUntilExit } = render(
    React.createElement(App, {
      onFocusAgent: (name: string) => controller.requestFocus(name),
      onQuit: () => controller.requestQuit(),
      waitForResume: () => controller.waitForResume(),
    })
  );

  // Wait for the app to fully exit (only happens on quit, not focus)
  await waitUntilExit();
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
        output(chalk.yellow('No agents found.'));
        output(chalk.dim('Run `opus-orchestra agents create` to create agents.'));
        return;
      }

      output(chalk.bold.blue('Opus Orchestra Status'));
      output(chalk.dim('─'.repeat(40)));
      output(`${chalk.cyan('Agents:')} ${agents.length}`);

      // Count sessions
      let activeSessions = 0;
      for (const agent of agents) {
        const sessionName = container.tmuxService.getAgentSessionName(agent);
        if (container.tmuxService.sessionExists(sessionName)) {
          activeSessions++;
        }
      }
      output(`${chalk.cyan('Active tmux sessions:')} ${activeSessions}`);
      output(chalk.dim('─'.repeat(40)));

      // List agents briefly
      for (const agent of agents) {
        const sessionName = container.tmuxService.getAgentSessionName(agent);
        const hasSession = container.tmuxService.sessionExists(sessionName);
        const status = hasSession ? chalk.green('●') : chalk.dim('○');
        output(`  ${status} ${chalk.bold(agent.name)} (${agent.branch})`);
      }

      output();
      output(chalk.dim('Run `opus-orchestra` for interactive dashboard.'));
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
        output(chalk.yellow('No agents found.'));
        return;
      }

      output(chalk.bold.blue('Agents'));
      output();

      for (const agent of agentList) {
        const sessionName = container.tmuxService.getAgentSessionName(agent);
        const hasSession = container.tmuxService.sessionExists(sessionName);
        const status = hasSession ? chalk.green('active') : chalk.dim('inactive');

        output(`${chalk.bold(agent.name)} ${chalk.dim(`(${status})`)}`);

        if (options.verbose) {
          output(`  ${chalk.dim('Branch:')} ${agent.branch}`);
          output(`  ${chalk.dim('Path:')} ${agent.worktreePath}`);
          output(`  ${chalk.dim('Container:')} ${agent.containerConfigName || 'unisolated'}`);
          output();
        }
      }

      if (!options.verbose) {
        output();
        output(chalk.dim('Use --verbose for more details.'));
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
        outputError(chalk.red('Count must be a whole number between 1 and 100.'));
        process.exit(1);
      }

      const repoPath = getEffectiveCwd();

      output(chalk.blue(`Creating ${count} agent(s)...`));

      // Use core AgentFactory for consistent agent creation
      // This ensures hooks, metadata, and coordination files are set up correctly
      const result = await container.agentFactory.createAgents(count, repoPath, {
        containerConfigName: options.container || 'unisolated',
        // No terminal creation callback - CLI doesn't manage terminals directly
        // Terminals are created when user focuses an agent
      });

      // Report created agents
      for (const agent of result.created) {
        output(chalk.green(`  ✓ ${agent.name} created (${agent.branch})`));
      }

      // Report skipped (already existed)
      if (result.skipped > 0) {
        output(chalk.yellow(`  Skipped ${result.skipped} existing worktree(s)`));
      }

      // Report errors
      for (const error of result.errors) {
        outputError(chalk.red(`  ✗ ${error.name}: ${error.error}`));
      }

      output();
      output(chalk.green(`Created ${result.created.length} agent(s).`));
      output(chalk.dim('Run `opus-orchestra` to manage agents interactively.'));
    } catch (err) {
      outputError(chalk.red('Failed to create agents:'), err);
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
        outputError(chalk.red(`Agent "${name}" not found.`));
        output(chalk.dim('Available agents:'));
        for (const a of agentList) {
          output(`  - ${a.name}`);
        }
        process.exit(1);
      }

      const sessionName = container.tmuxService.getAgentSessionName(agent);

      // Use atomic create-or-attach to avoid race conditions
      const sessionExistedBefore = container.tmuxService.sessionExists(sessionName);
      if (!sessionExistedBefore) {
        output(chalk.yellow(`No active tmux session for "${name}".`));
        output(chalk.dim('Starting a new session...'));
      }

      // Create session if needed (atomic operation with -A -d flags)
      container.tmuxService.createDetachedSession(sessionName, agent.worktreePath);

      // Set up oo alias only for newly created sessions
      if (!sessionExistedBefore) {
        // Wait for shell to initialize in the new tmux session (VS Code uses 200ms)
        sleepSync(200);
        const claudeCommand = container.config.get('claudeCommand') || 'claude';
        const sessionIdForAlias = agent.sessionId || agent.name;
        container.tmuxService.setupOoAlias(sessionName, claudeCommand, sessionIdForAlias);
      }

      output(chalk.blue(`Attaching to ${name}...`));
      output(chalk.dim('(Press Ctrl+B, D to detach and return)'));

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
        outputError(chalk.red(`Failed to spawn tmux: ${err.message}`));
        outputError(chalk.dim('Make sure tmux is installed and available in PATH.'));
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
      outputError(chalk.red('Failed to focus agent:'), err);
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
        outputError(chalk.red(`Agent "${name}" not found.`));
        process.exit(1);
      }

      if (!options.force) {
        output(chalk.yellow(`This will delete agent "${name}" and its worktree.`));
        output(chalk.dim('Use --force to skip this warning.'));

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
          output('Cancelled.');
          process.exit(0);
        }
      }

      output(chalk.blue(`Deleting ${name}...`));

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

      output(chalk.green(`✓ Agent "${name}" deleted.`));
    } catch (err) {
      outputError(chalk.red('Failed to delete agent:'), err);
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

      output(chalk.bold.blue('Configuration'));
      output();

      for (const [key, value] of Object.entries(allConfig)) {
        const formattedValue = typeof value === 'boolean'
          ? (value ? chalk.green('true') : chalk.red('false'))
          : chalk.cyan(String(value));
        output(`  ${chalk.dim(key + ':')} ${formattedValue}`);
      }

      output();
      output(chalk.dim('Use `opus-orchestra config set <key> <value>` to change values.'));
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
        outputError(chalk.red(`Unknown configuration key: ${key}`));
        output(chalk.dim('Available keys:'));
        for (const k of Object.keys(allConfig)) {
          output(`  - ${k}`);
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
          outputError(chalk.red(`Invalid number: ${value}`));
          process.exit(1);
        }
      } else {
        parsedValue = value;
      }

      await container.config.update(key as keyof typeof allConfig, parsedValue as never);
      output(chalk.green(`✓ Set ${key} = ${parsedValue}`));
    } catch (err) {
      outputError(chalk.red('Failed to set config:'), err);
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

  // Capture CLI output via CliOutput module
  const restoreOutput = captureOutput(
    (msg) => stdout.push(msg),
    (msg) => stderr.push(msg)
  );

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
    restoreOutput();
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
