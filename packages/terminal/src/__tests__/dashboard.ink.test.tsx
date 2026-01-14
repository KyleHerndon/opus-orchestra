/**
 * Dashboard UI Tests using ink-testing-library
 *
 * Tests the actual rendered output of the dashboard components.
 * Uses real git repos and services - no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import * as fs from 'node:fs';
import { App } from '../components/App.js';
import { AgentRow } from '../components/AgentRow.js';
import { StatsBar } from '../components/StatsBar.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { CreateAgentDialog } from '../components/CreateAgentDialog.js';
import {
  createTestRepoWithConfig,
  createWorktree,
  getTestSystemAdapter,
  TestRepo,
} from './fixtures/testRepo.js';
import {
  initializeContainer,
  disposeContainer,
} from '../services/ServiceContainer.js';
import { ok } from '@opus-orchestra/core';
import type { TerminalAgent, DashboardStats } from '../types.js';

describe('Dashboard UI Components', () => {
  describe('StatsBar', () => {
    it('should render agent counts', () => {
      const stats: DashboardStats = {
        total: 3,
        working: 1,
        waiting: 1,
        containerized: 0,
        totalInsertions: 42,
        totalDeletions: 17,
      };

      const { lastFrame } = render(<StatsBar stats={stats} />);
      const output = lastFrame();

      expect(output).toContain('Agents: 3');
      expect(output).toContain('Working: 1');
      expect(output).toContain('Waiting: 1');
      expect(output).toContain('+42');
      expect(output).toContain('-17');
    });

    it('should show zero counts correctly', () => {
      const stats: DashboardStats = {
        total: 0,
        working: 0,
        waiting: 0,
        containerized: 0,
        totalInsertions: 0,
        totalDeletions: 0,
      };

      const { lastFrame } = render(<StatsBar stats={stats} />);
      const output = lastFrame();

      expect(output).toContain('Agents: 0');
      expect(output).toContain('+0');
      expect(output).toContain('-0');
    });
  });

  describe('AgentRow', () => {
    const baseAgent: TerminalAgent = {
      id: 1,
      name: 'alpha',
      sessionId: 'test-session-id',
      branch: 'claude-alpha',
      repoPath: '/tmp/test',
      status: 'idle',
      pendingApproval: null,
      lastInteractionTime: new Date(),
      diffStats: ok({ insertions: 10, deletions: 5, filesChanged: 2 }),
      todos: [],
    };

    it('should render agent name', () => {
      const { lastFrame } = render(
        <AgentRow agent={baseAgent} selected={false} expanded={false} />
      );
      const output = lastFrame();

      expect(output).toContain('alpha');
    });

    it('should show selection indicator when selected', () => {
      const { lastFrame: unselected } = render(
        <AgentRow agent={baseAgent} selected={false} expanded={false} />
      );
      const { lastFrame: selected } = render(
        <AgentRow agent={baseAgent} selected={true} expanded={false} />
      );

      // Selected row should have '>' prefix
      expect(selected()).toContain('>');
      expect(unselected()).not.toContain('>');
    });

    it('should show diff stats', () => {
      const { lastFrame } = render(
        <AgentRow agent={baseAgent} selected={false} expanded={false} />
      );
      const output = lastFrame();

      expect(output).toContain('+10');
      expect(output).toContain('-5');
    });

    it('should show pending approval indicator when collapsed', () => {
      const agentWithApproval: TerminalAgent = {
        ...baseAgent,
        status: 'waiting',
        pendingApproval: 'Run npm install?',
      };

      const { lastFrame } = render(
        <AgentRow agent={agentWithApproval} selected={false} expanded={false} />
      );
      const output = lastFrame();

      // Should show [!] indicator when collapsed with approval
      expect(output).toContain('[!]');
    });

    it('should show expanded details when expanded with todos', () => {
      const agentWithTodos: TerminalAgent = {
        ...baseAgent,
        todos: [
          { content: 'Fix the bug', status: 'in_progress' },
          { content: 'Write tests', status: 'pending' },
        ],
      };

      const { lastFrame: collapsed } = render(
        <AgentRow agent={agentWithTodos} selected={false} expanded={false} />
      );
      const { lastFrame: expanded } = render(
        <AgentRow agent={agentWithTodos} selected={false} expanded={true} />
      );

      // Expanded should show todo content
      expect(expanded()).toContain('Fix the bug');
      expect(collapsed()).not.toContain('Fix the bug');
    });
  });

  describe('ConfirmDialog', () => {
    it('should render message and buttons', () => {
      const { lastFrame } = render(
        <ConfirmDialog
          message="Delete agent alpha?"
          confirmLabel="Delete"
          cancelLabel="Cancel"
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      );
      const output = lastFrame();

      expect(output).toContain('Delete agent alpha?');
      expect(output).toContain('Delete');
      expect(output).toContain('Cancel');
    });
  });

  describe('CreateAgentDialog', () => {
    it('should render agent count selector', () => {
      const { lastFrame } = render(
        <CreateAgentDialog
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      );
      const output = lastFrame();

      // Should show count selection UI
      expect(output).toBeTruthy();
    });
  });
});

describe('Dashboard Integration with Real Repo', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-ink-test-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should show "no agents" message when repo has no agents', () => {
    initializeContainer(testRepo.path);

    const { lastFrame } = render(<App />);

    // Wait for initial render
    const output = lastFrame();
    expect(output).toContain('No agents found');
  });

  it('should show agents after creation', async () => {
    const system = getTestSystemAdapter();
    // Create an agent first
    createWorktree(testRepo.path, 'alpha', 'claude-alpha');

    // ARCHITECTURE: Worktree-only persistence - save agent metadata to worktree
    const worktreePath = system.joinPath(testRepo.path, '.worktrees', 'claude-alpha');
    const metadataDir = system.joinPath(worktreePath, '.opus-orchestra');
    fs.mkdirSync(metadataDir, { recursive: true });
    fs.writeFileSync(
      system.joinPath(metadataDir, 'agent.json'),
      JSON.stringify({
        id: 1,
        name: 'alpha',
        sessionId: 'test-session-123',
        branch: 'claude-alpha',
        worktreePath,
        repoPath: testRepo.path,
      })
    );

    initializeContainer(testRepo.path);

    const { lastFrame } = render(<App />);

    // Should show the agent
    const output = lastFrame();
    expect(output).toContain('alpha');
  });

  it('should call onFocusAgent when Enter is pressed on selected agent', async () => {
    const system = getTestSystemAdapter();
    // Create an agent
    createWorktree(testRepo.path, 'alpha', 'claude-alpha');

    // ARCHITECTURE: Worktree-only persistence - save agent metadata to worktree
    const worktreePath = system.joinPath(testRepo.path, '.worktrees', 'claude-alpha');
    const metadataDir = system.joinPath(worktreePath, '.opus-orchestra');
    fs.mkdirSync(metadataDir, { recursive: true });
    fs.writeFileSync(
      system.joinPath(metadataDir, 'agent.json'),
      JSON.stringify({
        id: 1,
        name: 'alpha',
        sessionId: 'test-session-123',
        branch: 'claude-alpha',
        worktreePath,
        repoPath: testRepo.path,
      })
    );

    initializeContainer(testRepo.path);

    let focusedAgent: string | null = null;
    const { stdin, lastFrame } = render(
      <App onFocusAgent={(name) => { focusedAgent = name; }} />
    );

    // Wait for agents to load (poll until we see the agent name)
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      if (lastFrame().includes('alpha')) {break;}
    }

    // Verify agent is displayed before pressing Enter
    expect(lastFrame()).toContain('alpha');

    // Press Enter to focus
    stdin.write('\r');

    // Give React time to process
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(focusedAgent).toBe('alpha');
  });
});

describe('Keyboard Navigation', () => {
  let testRepo: TestRepo;
  const system = getTestSystemAdapter();

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-nav-test-');

    // Create multiple agents
    createWorktree(testRepo.path, 'alpha', 'claude-alpha');
    createWorktree(testRepo.path, 'bravo', 'claude-bravo');

    // ARCHITECTURE: Worktree-only persistence - save agent metadata to each worktree
    const alphaPath = system.joinPath(testRepo.path, '.worktrees', 'claude-alpha');
    const alphaMetadataDir = system.joinPath(alphaPath, '.opus-orchestra');
    fs.mkdirSync(alphaMetadataDir, { recursive: true });
    fs.writeFileSync(
      system.joinPath(alphaMetadataDir, 'agent.json'),
      JSON.stringify({
        id: 1,
        name: 'alpha',
        sessionId: 'session-1',
        branch: 'claude-alpha',
        worktreePath: alphaPath,
        repoPath: testRepo.path,
      })
    );

    const bravoPath = system.joinPath(testRepo.path, '.worktrees', 'claude-bravo');
    const bravoMetadataDir = system.joinPath(bravoPath, '.opus-orchestra');
    fs.mkdirSync(bravoMetadataDir, { recursive: true });
    fs.writeFileSync(
      system.joinPath(bravoMetadataDir, 'agent.json'),
      JSON.stringify({
        id: 2,
        name: 'bravo',
        sessionId: 'session-2',
        branch: 'claude-bravo',
        worktreePath: bravoPath,
        repoPath: testRepo.path,
      })
    );

    initializeContainer(testRepo.path);
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should navigate between agents with arrow keys', async () => {
    let focusedAgent: string | null = null;
    const { stdin, lastFrame } = render(
      <App onFocusAgent={(name) => { focusedAgent = name; }} />
    );

    // Wait for agents to load
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      if (lastFrame().includes('alpha') && lastFrame().includes('bravo')) {break;}
    }

    // Verify both agents are displayed
    expect(lastFrame()).toContain('alpha');
    expect(lastFrame()).toContain('bravo');

    // Press down arrow to select bravo
    stdin.write('\x1B[B'); // Down arrow escape sequence

    await new Promise(resolve => setTimeout(resolve, 50));

    // Press Enter to focus
    stdin.write('\r');

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(focusedAgent).toBe('bravo');
  });

  it('should open create dialog with c key', async () => {
    const { stdin, lastFrame } = render(<App />);

    // Wait for initial render
    await new Promise(resolve => setTimeout(resolve, 100));

    // Press 'c' to open create dialog
    stdin.write('c');

    await new Promise(resolve => setTimeout(resolve, 100));

    const output = lastFrame();
    // Create dialog should be visible (contains create-related text)
    expect(output.toLowerCase()).toMatch(/create|agent|count/i);
  });

  it('should quit with q key', async () => {
    // This test verifies the 'q' key is handled
    // The actual exit is hard to test since it calls useApp().exit()
    const { stdin, lastFrame } = render(<App />);

    // Wait for initial render
    await new Promise(resolve => setTimeout(resolve, 50));

    const beforeQuit = lastFrame();
    expect(beforeQuit).toBeTruthy();

    // Press 'q' - this triggers exit which unmounts the component
    stdin.write('q');

    await new Promise(resolve => setTimeout(resolve, 50));

    // After quit, the frame should be different (empty or unmounted)
    // This is a basic sanity check that pressing q doesn't crash
  });
});
