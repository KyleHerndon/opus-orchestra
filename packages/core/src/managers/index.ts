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
  PollingConfig,
  DEFAULT_POLLING_CONFIG,
} from './AgentStatusTracker';

// AgentPersistence
export {
  AgentPersistence,
  IAgentPersistence,
  RepoAgentOrderMap,
} from './AgentPersistence';

// ContainerManager
export {
  ContainerManager,
  IContainerManager,
  IContainerConfigProvider,
  ContainerConfigRef,
} from './ContainerManager';
