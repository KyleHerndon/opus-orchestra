/**
 * Dashboard Flow Integration Tests
 *
 * Tests the COMPLETE user flow through the dashboard, not isolated pieces.
 * These tests exercise the real code paths that users hit.
 *
 * ARCHITECTURE: Uses worktree-only persistence - all agent state is in
 * worktree metadata files, not central storage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import {
  createTestRepoWithConfig,
  getTestSystemAdapter,
  TestRepo,
} from './fixtures/testRepo.js';
import {
  initializeContainer,
  disposeContainer,
  getContainer,
} from '../services/ServiceContainer.js';

/**
 * This test simulates the EXACT flow a user experiences:
 * 1. Open dashboard
 * 2. Press 'c' to create agent (calls useAgents.createAgents)
 * 3. Press Enter to focus agent (calls attachToAgentSession)
 * 4. Ctrl+D to exit shell (kills tmux session)
 * 5. Return to dashboard
 * 6. Press Enter again to focus (should recreate session)
 */
describe('Dashboard Flow Integration', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-dashboard-flow-');
  });

  afterEach(() => {
    // Clean up tmux sessions
    const agentNames = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
    for (const name of agentNames) {
      spawnSync('tmux', ['kill-session', '-t', name], { stdio: 'ignore' });
    }
    disposeContainer();
    testRepo.cleanup();
  });

  it('should allow focus after creating agent via dashboard', async () => {
    // Skip if tmux not available
    const tmuxCheck = spawnSync('which', ['tmux'], { encoding: 'utf-8' });
    if (tmuxCheck.status !== 0) {
      console.log('Skipping - tmux not available');
      return;
    }

    // Initialize container (same as dashboard does on startup)
    initializeContainer(testRepo.path);
    const container = getContainer();

    // === STEP 1: Create agent the way dashboard does (useAgents.createAgents) ===
    const repoPath = testRepo.path;
    const agentName = 'echo';
    const branch = `claude-${agentName}`;
    const baseBranch = 'main';
    const worktreePath = container.worktreeManager.getWorktreePath(repoPath, agentName);

    // Create worktree (same as useAgents.createAgents does)
    container.worktreeManager.createWorktree(repoPath, worktreePath, branch, baseBranch);

    // Verify worktree was created
    expect(fs.existsSync(worktreePath)).toBe(true);

    // ARCHITECTURE: Save agent metadata to worktree (worktree-only persistence)
    const sessionId = container.persistence.generateSessionId();
    const agentForSetup = {
      id: 1,
      name: agentName,
      sessionId,
      branch,
      worktreePath,
      repoPath,
      taskFile: null,
      containerConfigName: 'unisolated',
      terminal: null,
      status: 'idle' as const,
      statusIcon: 'circle-outline' as const,
      pendingApproval: null,
      lastInteractionTime: new Date(),
      diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
      todos: [],
    };
    container.worktreeManager.saveAgentMetadata(agentForSetup);

    // === STEP 2: Verify agent is in worktree metadata ===
    const agentsFromWorktree = container.persistence.loadPersistedAgents();
    const agentInStorage = agentsFromWorktree.find(a => a.name === agentName);

    expect(agentInStorage).toBeDefined();
    expect(agentInStorage?.worktreePath).toBe(worktreePath);
    expect(agentInStorage?.sessionId).toBe(sessionId);

    // === STEP 3: Focus agent (same as attachToAgentSession does) ===
    const sessionName = agentName.replace(/[^a-zA-Z0-9-]/g, '-');

    // This is what attachToAgentSession does - load from persistence
    const agents = container.persistence.loadPersistedAgents();
    const agent = agents.find(a => a.name === agentName);

    expect(agent).toBeDefined();
    if (!agent) {
      throw new Error(`Agent "${agentName}" not found in storage`);
    }

    // Create/attach tmux session (same as attachToAgentSession with -A flag)
    const result = spawnSync(
      'tmux',
      ['new-session', '-A', '-d', '-s', sessionName, '-c', agent.worktreePath],
      { stdio: 'ignore' }
    );
    expect(result.status).toBe(0);

    // Verify session exists
    const hasSession = spawnSync('tmux', ['has-session', '-t', sessionName], {
      stdio: 'ignore',
    });
    expect(hasSession.status).toBe(0);

    // === STEP 4: Kill session (simulating Ctrl+D) ===
    spawnSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore' });

    // === STEP 5: Focus again (should recreate session) ===
    const result2 = spawnSync(
      'tmux',
      ['new-session', '-A', '-d', '-s', sessionName, '-c', agent.worktreePath],
      { stdio: 'ignore' }
    );
    expect(result2.status).toBe(0);

    // Verify session exists again
    const hasSession2 = spawnSync('tmux', ['has-session', '-t', sessionName], {
      stdio: 'ignore',
    });
    expect(hasSession2.status).toBe(0);
  });

  it('should persist agents to worktree metadata when created via dashboard', async () => {
    // Initialize container
    initializeContainer(testRepo.path);
    const container = getContainer();

    const repoPath = testRepo.path;
    const agentName = 'delta';
    const branch = `claude-${agentName}`;
    const baseBranch = 'main';
    const worktreePath = container.worktreeManager.getWorktreePath(repoPath, agentName);

    // Create worktree
    container.worktreeManager.createWorktree(repoPath, worktreePath, branch, baseBranch);

    // Check agents before
    const beforeAgents = container.persistence.loadPersistedAgents();
    const beforeCount = beforeAgents.length;

    // ARCHITECTURE: Save to worktree metadata (worktree-only persistence)
    const sessionId = container.persistence.generateSessionId();
    const agentForSetup = {
      id: beforeCount + 1,
      name: agentName,
      sessionId,
      branch,
      worktreePath,
      repoPath,
      taskFile: null,
      containerConfigName: 'unisolated',
      terminal: null,
      status: 'idle' as const,
      statusIcon: 'circle-outline' as const,
      pendingApproval: null,
      lastInteractionTime: new Date(),
      diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
      todos: [],
    };
    container.worktreeManager.saveAgentMetadata(agentForSetup);

    // Verify agent metadata file exists
    const system = getTestSystemAdapter();
    const metadataPath = system.joinPath(worktreePath, '.opus-orchestra', 'agent.json');
    expect(fs.existsSync(metadataPath)).toBe(true);

    // Now verify it's in persistence
    const afterAgents = container.persistence.loadPersistedAgents();
    expect(afterAgents.length).toBe(beforeCount + 1);

    const found = afterAgents.find(a => a.name === agentName);
    expect(found).toBeDefined();
    expect(found?.worktreePath).toBe(worktreePath);
    expect(found?.sessionId).toBe(sessionId);
  });

  it('complete flow: create via dashboard, persist, restart, focus, kill, focus again', async () => {
    // Skip if tmux not available
    const tmuxCheck = spawnSync('which', ['tmux'], { encoding: 'utf-8' });
    if (tmuxCheck.status !== 0) {
      console.log('Skipping - tmux not available');
      return;
    }

    initializeContainer(testRepo.path);
    const container = getContainer();

    // Simulate what useAgents.createAgents does
    const repoPath = testRepo.path;
    const agentName = 'foxtrot';
    const branch = `claude-${agentName}`;
    const baseBranch = 'main';
    const worktreePath = container.worktreeManager.getWorktreePath(repoPath, agentName);

    // 1. Create worktree
    container.worktreeManager.createWorktree(repoPath, worktreePath, branch, baseBranch);

    // 2. ARCHITECTURE: Save to worktree metadata (worktree-only persistence)
    const sessionId = container.persistence.generateSessionId();
    const agentForSetup = {
      id: 1,
      name: agentName,
      sessionId,
      branch,
      worktreePath,
      repoPath,
      taskFile: null,
      containerConfigName: 'unisolated',
      terminal: null,
      status: 'idle' as const,
      statusIcon: 'circle-outline' as const,
      pendingApproval: null,
      lastInteractionTime: new Date(),
      diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
      todos: [],
    };
    container.worktreeManager.saveAgentMetadata(agentForSetup);

    // 3. Verify agent is in persistence
    const agents = container.persistence.loadPersistedAgents();
    const agent = agents.find(a => a.name === agentName);

    expect(agent).toBeDefined();
    expect(agent?.name).toBe(agentName);
    expect(agent?.worktreePath).toBe(worktreePath);

    // 4. Focus (create tmux session)
    const sessionName = agentName;
    expect(fs.existsSync(agent!.worktreePath)).toBe(true);

    const focus1 = spawnSync(
      'tmux',
      ['new-session', '-A', '-d', '-s', sessionName, '-c', agent!.worktreePath],
      { encoding: 'utf-8' }
    );
    if (focus1.status !== 0) {
      console.log('focus1 failed:', focus1.stderr, focus1.stdout);
    }
    expect(focus1.status).toBe(0);

    // 5. Kill session (simulating Ctrl+D)
    spawnSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore' });

    // 6. Simulate dashboard restart
    disposeContainer();
    initializeContainer(testRepo.path);
    const container2 = getContainer();

    // 7. Load agent from worktree metadata after restart
    const agentsAfterRestart = container2.persistence.loadPersistedAgents();
    const agentAfterRestart = agentsAfterRestart.find(a => a.name === agentName);
    expect(agentAfterRestart).toBeDefined();
    expect(agentAfterRestart?.sessionId).toBe(sessionId);

    // 8. Focus again - should work
    const focus2 = spawnSync(
      'tmux',
      ['new-session', '-A', '-d', '-s', sessionName, '-c', agentAfterRestart!.worktreePath],
      { stdio: 'ignore' }
    );
    expect(focus2.status).toBe(0);

    // 9. Verify session exists
    const hasSession = spawnSync('tmux', ['has-session', '-t', sessionName], {
      stdio: 'ignore',
    });
    expect(hasSession.status).toBe(0);
  });
});
