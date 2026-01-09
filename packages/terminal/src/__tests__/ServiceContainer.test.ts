/**
 * Tests for ServiceContainer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ServiceContainer,
  initializeContainer,
  getContainer,
  isContainerInitialized,
  disposeContainer,
} from '../services/ServiceContainer.js';
import { createTestRepoWithConfig, TestRepo } from './fixtures/testRepo.js';

describe('ServiceContainer', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    // Ensure no leftover container from previous tests
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-container-test-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  describe('constructor', () => {
    it('should create container with all required adapters', () => {
      const container = new ServiceContainer(testRepo.path);

      expect(container.system).toBeDefined();
      expect(container.storage).toBeDefined();
      expect(container.config).toBeDefined();
      expect(container.ui).toBeDefined();
      expect(container.terminal).toBeDefined();

      container.dispose();
    });

    it('should create container with all required services', () => {
      const container = new ServiceContainer(testRepo.path);

      expect(container.logger).toBeDefined();
      expect(container.eventBus).toBeDefined();
      expect(container.gitService).toBeDefined();
      expect(container.statusService).toBeDefined();
      expect(container.tmuxService).toBeDefined();

      container.dispose();
    });

    it('should create container with all required managers', () => {
      const container = new ServiceContainer(testRepo.path);

      expect(container.worktreeManager).toBeDefined();
      expect(container.statusTracker).toBeDefined();
      expect(container.persistence).toBeDefined();
      expect(container.containerManager).toBeDefined();

      container.dispose();
    });

    it('should create container with container registry', () => {
      const container = new ServiceContainer(testRepo.path);

      expect(container.containerRegistry).toBeDefined();

      container.dispose();
    });

    it('should load config from config file', () => {
      const container = new ServiceContainer(testRepo.path);

      // The test repo was created with custom config values
      expect(container.config.get('tmuxSessionPrefix')).toBe('opus-test');
      expect(container.config.get('defaultAgentCount')).toBe(3);

      container.dispose();
    });
  });

  describe('dispose', () => {
    it('should not throw when disposing', () => {
      const container = new ServiceContainer(testRepo.path);

      expect(() => container.dispose()).not.toThrow();
    });

    it('should be safe to call multiple times', () => {
      const container = new ServiceContainer(testRepo.path);

      expect(() => {
        container.dispose();
        container.dispose();
      }).not.toThrow();
    });
  });
});

describe('Global Container Functions', () => {
  let testRepo: TestRepo;

  beforeEach(() => {
    disposeContainer();
    testRepo = createTestRepoWithConfig('opus-global-test-');
  });

  afterEach(() => {
    disposeContainer();
    testRepo.cleanup();
  });

  describe('isContainerInitialized', () => {
    it('should return false when not initialized', () => {
      expect(isContainerInitialized()).toBe(false);
    });

    it('should return true after initialization', () => {
      initializeContainer(testRepo.path);
      expect(isContainerInitialized()).toBe(true);
    });

    it('should return false after disposal', () => {
      initializeContainer(testRepo.path);
      disposeContainer();
      expect(isContainerInitialized()).toBe(false);
    });
  });

  describe('initializeContainer', () => {
    it('should create and return container', () => {
      const container = initializeContainer(testRepo.path);

      expect(container).toBeInstanceOf(ServiceContainer);
    });

    it('should dispose previous container on re-initialization', () => {
      const container1 = initializeContainer(testRepo.path);
      const container2 = initializeContainer(testRepo.path);

      // Should be different instances
      expect(container1).not.toBe(container2);
    });
  });

  describe('getContainer', () => {
    it('should throw when not initialized', () => {
      expect(() => getContainer()).toThrow('ServiceContainer not initialized');
    });

    it('should return container when initialized', () => {
      const initialized = initializeContainer(testRepo.path);
      const retrieved = getContainer();

      expect(retrieved).toBe(initialized);
    });
  });

  describe('disposeContainer', () => {
    it('should not throw when not initialized', () => {
      expect(() => disposeContainer()).not.toThrow();
    });

    it('should dispose and clear container', () => {
      initializeContainer(testRepo.path);
      disposeContainer();

      expect(isContainerInitialized()).toBe(false);
    });
  });
});
