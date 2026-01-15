/**
 * Core managers
 *
 * Platform-agnostic manager implementations.
 */

// WorktreeManager
export {
  WorktreeManager,
  IWorktreeManager,
} from './WorktreeManager';

// AgentStatusTracker
export {
  AgentStatusTracker,
  IAgentStatusTracker,
  AgentUpdateCallback,
  PollingConfig,
  DEFAULT_POLLING_CONFIG,
} from './AgentStatusTracker';

// AgentPersistence
export {
  AgentPersistence,
  IAgentPersistence,
} from './AgentPersistence';

// ContainerManager
export {
  ContainerManager,
  IContainerManager,
  IContainerConfigProvider,
  ContainerConfigRef,
} from './ContainerManager';

// AgentFactory
export {
  AgentFactory,
  IAgentFactory,
  AgentCreationResult,
  AgentCreationOptions,
} from './AgentFactory';
