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

const program = new Command();

program
  .name('opus-orchestra')
  .description('Terminal UI for Opus Orchestra - manage Claude Code agents')
  .version('0.2.0');

/**
 * Initialize the ServiceContainer for the current working directory.
 */
function ensureContainer(): void {
  if (!isContainerInitialized()) {
    initializeContainer(process.cwd());
  }
}

/**
 * Format time ago string
 */
function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/**
 * Get the tmux session name for an agent.
 * Uses sessionId-based naming (via TmuxService) when available for stability across renames.
 * Falls back to sanitized agent name for backward compatibility with older agents.
 */
function getAgentSessionName(
  agent: { sessionId?: string; name: string },
  tmuxService: { getSessionName(sessionId: string): string }
): string {
  return agent.sessionId
    ? tmuxService.getSessionName(agent.sessionId)
    : agent.name.replace(/[^a-zA-Z0-9-]/g, '-');
}

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

  // Use sessionId-based naming for stability across renames (matches VS Code extension)
  const sessionName = getAgentSessionName(agent, container.tmuxService);

  // Check if this is a new session (for oo alias setup)
  const isNewSession = !container.tmuxService.sessionExists(sessionName);

  // Clear screen and show hint
  console.clear();
  console.log(chalk.blue(`Attaching to ${agentName}...`));
  console.log(chalk.dim('(Press Ctrl+B, D to detach and return to dashboard)\n'));

  if (isNewSession) {
    // Create detached session first
    container.tmuxService.createDetachedSession(sessionName, agent.worktreePath);

    // Set up oo alias (use sessionId if available, otherwise agent name)
    const claudeCommand = container.config.get('claudeCommand') || 'claude';
    const sessionIdForAlias = agent.sessionId || agent.name;
    container.tmuxService.setupOoAlias(sessionName, claudeCommand, sessionIdForAlias);

    // Now attach to the session
    spawnSync('tmux', ['attach-session', '-t', sessionName], {
      stdio: 'inherit',
    });
  } else {
    // Session already exists - just attach
    spawnSync('tmux', ['attach-session', '-t', sessionName], {
      stdio: 'inherit',
    });
  }

  // Clear screen before returning to dashboard
  console.clear();
}

/**
 * Run the dashboard in a loop, returning after tmux detach.
 */
async function runDashboardLoop(): Promise<void> {
  // State to track focus request from dashboard
  const state: DashboardState = { focusAgent: null };

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
        const sessionName = getAgentSessionName(agent, container.tmuxService);
        if (container.tmuxService.sessionExists(sessionName)) {
          activeSessions++;
        }
      }
      console.log(`${chalk.cyan('Active tmux sessions:')} ${activeSessions}`);
      console.log(chalk.dim('─'.repeat(40)));

      // List agents briefly
      for (const agent of agents) {
        const sessionName = getAgentSessionName(agent, container.tmuxService);
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
        const sessionName = getAgentSessionName(agent, container.tmuxService);
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
      const count = parseInt(countStr, 10);
      if (isNaN(count) || count < 1 || count > 10) {
        console.error(chalk.red('Count must be between 1 and 10.'));
        process.exit(1);
      }

      const repoPath = process.cwd();
      const baseBranch = await container.gitService.getBaseBranch(repoPath);

      // Get existing agent names from persistence
      const existing = container.persistence.loadPersistedAgents();
      const usedNames = new Set(existing.map((a) => a.name));

      // Also check for existing worktree directories
      const allNames = [
        'alpha', 'bravo', 'charlie', 'delta', 'echo',
        'foxtrot', 'golf', 'hotel', 'india', 'juliet',
      ];

      const availableNames = allNames.filter((n) => {
        if (usedNames.has(n)) return false;
        // Check if worktree directory already exists
        const worktreePath = container.worktreeManager.getWorktreePath(repoPath, n);
        if (container.worktreeManager.worktreeExists(worktreePath)) return false;
        return true;
      });

      if (availableNames.length < count) {
        console.error(chalk.red(`Only ${availableNames.length} agent names available.`));
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

      // Persist newly created agents along with existing ones
      const allAgents = [...existing, ...createdAgents];
      await container.storage.set('opus.agents', allAgents);

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

      const sessionName = getAgentSessionName(agent, container.tmuxService);

      if (!container.tmuxService.sessionExists(sessionName)) {
        console.log(chalk.yellow(`No active tmux session for "${name}".`));
        console.log(chalk.dim('Starting a new session...'));

        // Create detached session and set up oo alias
        container.tmuxService.createDetachedSession(sessionName, agent.worktreePath);

        // Set up oo alias (use sessionId if available, otherwise agent name)
        const claudeCommand = container.config.get('claudeCommand') || 'claude';
        const sessionIdForAlias = agent.sessionId || agent.name;
        container.tmuxService.setupOoAlias(sessionName, claudeCommand, sessionIdForAlias);
      }

      console.log(chalk.blue(`Attaching to ${name}...`));
      console.log(chalk.dim('(Press Ctrl+B, D to detach and return)'));

      // Attach to session - this replaces current process
      const { spawn } = await import('node:child_process');
      const child = spawn('tmux', ['attach-session', '-t', sessionName], {
        stdio: 'inherit',
      });

      child.on('exit', (code) => {
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
      const sessionName = getAgentSessionName(agent, container.tmuxService);
      container.tmuxService.killSession(sessionName);

      // Remove worktree
      container.worktreeManager.removeWorktree(
        agent.repoPath,
        agent.worktreePath,
        agent.branch
      );

      // Remove from storage
      const remainingAgents = agentList.filter((a) => a.name !== name);
      await container.storage.set('opus.agents', remainingAgents);

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
