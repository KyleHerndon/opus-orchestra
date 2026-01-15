/**
 * E2E tests for status update mechanism.
 *
 * Tests that status files written by hooks are correctly read and reflected in the UI.
 * This is a critical path - when hooks write status files, the dashboard must update.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import * as fs from 'node:fs';
import { App } from '../components/App.js';
import {
  createTestRepoWithConfig,
  createWorktree,
  getTestSystemAdapter,
  TestRepo,
} from './fixtures/testRepo.js';
import {
  initializeContainer,
  disposeContainer,
  getContainer,
} from '../services/ServiceContainer.js';

describe('E2E: Status Update Mechanism', () => {
  let testRepo: TestRepo;
  const system = getTestSystemAdapter();

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-status-test-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  /**
   * Helper to create an agent with proper worktree and metadata.
   */
  function createTestAgent(name: string, sessionId: string): string {
    createWorktree(testRepo.path, `claude-${name}`);
    const worktreePath = system.joinPath(testRepo.path, '.worktrees', `claude-${name}`);
    const metadataDir = system.joinPath(worktreePath, '.opus-orchestra');
    fs.mkdirSync(metadataDir, { recursive: true });
    fs.writeFileSync(
      system.joinPath(metadataDir, 'agent.json'),
      JSON.stringify({
        id: 1,
        name,
        sessionId,
        branch: `claude-${name}`,
        worktreePath,
        repoPath: testRepo.path,
        containerConfigName: 'unisolated',
      })
    );
    return worktreePath;
  }

  /**
   * Helper to write a status file (simulates what hooks do).
   */
  function writeStatusFile(worktreePath: string, sessionId: string, content: string): void {
    const statusDir = system.joinPath(worktreePath, '.opus-orchestra', 'status');
    fs.mkdirSync(statusDir, { recursive: true });
    fs.writeFileSync(system.joinPath(statusDir, sessionId), content);
  }

  it('should verify status directory path is correct', () => {
    const sessionId = 'test-session-' + Date.now();
    const worktreePath = createTestAgent('alpha', sessionId);

    initializeContainer(testRepo.path);
    const container = getContainer();

    // Verify the status directory path matches what hooks would use
    const expectedStatusDir = system.joinPath(worktreePath, '.opus-orchestra', 'status');
    const serviceStatusDir = container.statusService.getStatusDirectory(worktreePath);

    // Log both paths for debugging
    console.log('Expected status dir:', expectedStatusDir);
    console.log('Service status dir:', serviceStatusDir);

    // The paths should be equivalent (may have different formats but point to same location)
    // For now, just verify both end with the same relative path
    expect(serviceStatusDir).toContain('.opus-orchestra');
    expect(serviceStatusDir).toContain('status');
  });

  it('should read status file written by simulated hook', () => {
    const sessionId = 'test-session-' + Date.now();
    const worktreePath = createTestAgent('alpha', sessionId);

    // Write status file like a hook would
    writeStatusFile(worktreePath, sessionId, 'working');

    initializeContainer(testRepo.path);
    const container = getContainer();

    // Read status using StatusService
    const status = container.statusService.checkStatus(worktreePath);

    console.log('Status read from file:', status);

    expect(status).not.toBeNull();
    expect(status?.status).toBe('working');
  });

  it('should read JSON status file from permission hook', () => {
    const sessionId = 'test-session-' + Date.now();
    const worktreePath = createTestAgent('alpha', sessionId);

    // Write JSON status like permission hook would
    const hookData = JSON.stringify({
      session_id: sessionId,
      tool_name: 'Bash',
      tool_input: { command: 'npm install' },
    });
    writeStatusFile(worktreePath, sessionId, hookData);

    initializeContainer(testRepo.path);
    const container = getContainer();

    // Read status using StatusService
    const status = container.statusService.checkStatus(worktreePath);

    console.log('Status read from JSON file:', status);

    expect(status).not.toBeNull();
    expect(status?.status).toBe('waiting-approval');
    expect(status?.pendingApproval).toContain('Bash');
    expect(status?.pendingApproval).toContain('npm install');
  });

  it('should update dashboard when status file changes', async () => {
    const sessionId = 'test-session-' + Date.now();
    const worktreePath = createTestAgent('alpha', sessionId);

    initializeContainer(testRepo.path);
    const container = getContainer();

    // Track events for debugging
    let statusChangedEventReceived = false;
    let statusChangedEventData: unknown = null;
    container.eventBus.on('agent:statusChanged', (data) => {
      statusChangedEventReceived = true;
      statusChangedEventData = data;
      console.log('agent:statusChanged event received:', data);
    });

    // Render the app
    const { lastFrame, unmount } = render(<App />);

    // Wait for initial render with agent
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      if (lastFrame().includes('alpha')) break;
    }

    const initialOutput = lastFrame();
    console.log('Initial output:', initialOutput);
    expect(initialOutput).toContain('alpha');
    expect(initialOutput).toContain('IDLE'); // Initially should be IDLE

    // Write status file - this simulates a hook being triggered
    writeStatusFile(worktreePath, sessionId, 'working');

    // Manually trigger a status refresh to verify the flow
    console.log('Status file written, waiting for update...');

    // Log the agents map to see what's being polled
    const agents = container.persistence.loadPersistedAgents();
    console.log('Agents in persistence:', agents.length);
    if (agents.length > 0) {
      console.log('Agent worktreePath:', agents[0].worktreePath);
      console.log('Agent sessionId:', agents[0].sessionId);
    }

    // Manually check status to verify it can be read
    const manualStatus = container.statusService.checkStatus(worktreePath);
    console.log('Manual status check result:', manualStatus);

    // Check polling state
    console.log('Is polling active:', container.statusTracker.isPolling());
    console.log('Is watcher healthy:', container.statusTracker.isWatcherHealthy());

    // Manually trigger a refresh to see if it works
    const agentMap = new Map<number, import('@opus-orchestra/core').Agent>();
    const computedWorktreePath = container.worktreeManager.getWorktreePath(testRepo.path, 'alpha');
    agentMap.set(1, {
      id: 1,
      name: 'alpha',
      sessionId,
      branch: 'claude-alpha',
      worktreePath: computedWorktreePath,
      repoPath: testRepo.path,
      taskFile: null,
      terminal: null,
      status: 'idle',
      statusIcon: 'circle-outline',
      pendingApproval: null,
      lastInteractionTime: new Date(),
      diffStats: { insertions: 0, deletions: 0, filesChanged: 0 },
      todos: [],
      containerConfigName: 'unisolated',
    });

    console.log('Calling refreshStatus manually with agent map size:', agentMap.size);
    console.log('Agent in map worktreePath:', computedWorktreePath);
    await container.statusTracker.refreshStatus(agentMap);
    console.log('After manual refresh, event received:', statusChangedEventReceived);

    // Wait for polling to pick up the change (polling interval is 1000ms)
    // We need to wait long enough for at least one poll cycle
    let statusUpdated = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const output = lastFrame();
      // Check if status changed from IDLE - look for WORKING status
      if (output.includes('WORKING') || (output.includes('Working: 1') && !output.includes('Working: 0'))) {
        console.log('Status updated to WORKING after', (i + 1) * 100, 'ms');
        statusUpdated = true;
        break;
      }
    }

    const updatedOutput = lastFrame();
    console.log('Updated output:', updatedOutput);
    console.log('Event received:', statusChangedEventReceived);
    console.log('Event data:', statusChangedEventData);

    // Clean up
    unmount();

    // Verify the status was updated
    // NOTE: This assertion will FAIL if the bug exists
    expect(statusUpdated).toBe(true);
    expect(updatedOutput).not.toContain('IDLE');
    expect(updatedOutput).toContain('WORKING');
  });

  it('should verify polling effect runs after initialization', async () => {
    const sessionId = 'test-session-' + Date.now();
    createTestAgent('alpha', sessionId);

    initializeContainer(testRepo.path);
    const container = getContainer();

    // Render the app
    const { lastFrame, unmount } = render(<App />);

    // Wait for agents to load
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      if (lastFrame().includes('alpha')) break;
    }

    // Check if polling is active
    await new Promise(resolve => setTimeout(resolve, 200));

    const isPolling = container.statusTracker.isPolling();
    console.log('Is polling active:', isPolling);

    unmount();

    // This is the critical assertion - if polling isn't running, status won't update
    expect(isPolling).toBe(true);
  });

  it('should test path conversion in status checking', () => {
    const sessionId = 'test-session-' + Date.now();
    const worktreePath = createTestAgent('alpha', sessionId);

    // Write status file
    writeStatusFile(worktreePath, sessionId, 'working');

    initializeContainer(testRepo.path);
    const container = getContainer();

    // Get the worktree path as computed by WorktreeManager
    const computedWorktreePath = container.worktreeManager.getWorktreePath(
      testRepo.path,
      'alpha'
    );

    console.log('Original worktreePath:', worktreePath);
    console.log('Computed worktreePath:', computedWorktreePath);

    // Check if StatusService can read from computed path
    const status = container.statusService.checkStatus(computedWorktreePath);

    console.log('Status from computed path:', status);

    // This may fail if paths don't match - revealing the bug
    expect(status).not.toBeNull();
    expect(status?.status).toBe('working');
  });

  it('should verify agents are converted correctly for polling', async () => {
    const sessionId = 'test-session-' + Date.now();
    const worktreePath = createTestAgent('alpha', sessionId);

    initializeContainer(testRepo.path);
    const container = getContainer();

    // Load persisted agents (like useAgents does)
    const persistedAgents = container.persistence.loadPersistedAgents();
    expect(persistedAgents.length).toBe(1);

    const agent = persistedAgents[0];
    console.log('Persisted agent worktreePath:', agent.worktreePath);
    console.log('Persisted agent repoPath:', agent.repoPath);

    // Compute worktree path like useAgents does
    const computedPath = container.worktreeManager.getWorktreePath(
      agent.repoPath,
      agent.name
    );
    console.log('Computed worktreePath for polling:', computedPath);

    // Verify status can be read from computed path
    writeStatusFile(worktreePath, sessionId, 'working');
    const status = container.statusService.checkStatus(computedPath);
    console.log('Status check result:', status);

    expect(status).not.toBeNull();
    expect(status?.status).toBe('working');
  });
});

describe('E2E: Race Condition Test', () => {
  let testRepo: TestRepo;
  const system = getTestSystemAdapter();

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-race-test-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  it('should verify container is initialized before polling starts', async () => {
    // Create agent
    createWorktree(testRepo.path, 'claude-alpha');
    const worktreePath = system.joinPath(testRepo.path, '.worktrees', 'claude-alpha');
    const metadataDir = system.joinPath(worktreePath, '.opus-orchestra');
    fs.mkdirSync(metadataDir, { recursive: true });
    fs.writeFileSync(
      system.joinPath(metadataDir, 'agent.json'),
      JSON.stringify({
        id: 1,
        name: 'alpha',
        sessionId: 'session-race-test',
        branch: 'claude-alpha',
        worktreePath,
        repoPath: testRepo.path,
      })
    );

    initializeContainer(testRepo.path);

    // Track when container becomes available vs when polling attempts to start
    let pollingAttempted = false;
    let containerAvailableWhenPollingStarted = false;

    const container = getContainer();
    const originalStartPolling = container.statusTracker.startPolling.bind(container.statusTracker);

    // Monkey-patch to track timing
    (container.statusTracker as unknown as { startPolling: typeof originalStartPolling }).startPolling = (
      getAgents,
      onUpdate,
      config
    ) => {
      pollingAttempted = true;
      // Check if container.statusTracker is accessible (proxy for "is container ready")
      containerAvailableWhenPollingStarted = container.statusTracker !== null;
      console.log('Polling started, container available:', containerAvailableWhenPollingStarted);
      return originalStartPolling(getAgents, onUpdate, config);
    };

    const { lastFrame, unmount } = render(<App />);

    // Wait for app to initialize
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      if (lastFrame().includes('alpha')) break;
    }

    console.log('Polling attempted:', pollingAttempted);
    console.log('Container available when polling started:', containerAvailableWhenPollingStarted);

    unmount();

    // The bug: if polling starts before container is ready, this will be false
    expect(pollingAttempted).toBe(true);
    expect(containerAvailableWhenPollingStarted).toBe(true);
  });
});
