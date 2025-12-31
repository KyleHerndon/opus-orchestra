# Future Migration Work

This document tracks remaining migration items for the UI/CORE separation.

---

## Completed in This PR

- [x] ServiceContainer composition root implemented
- [x] Singleton services delegate to ServiceContainer
- [x] ContainerManager migrated to core
- [x] Agent type unified, TerminalAdapter migrated
- [x] Container adapters consolidated
- [x] Legacy vscode-extension/ directory removed from git tracking
- [x] AgentPersistence tests (21 tests)
- [x] EventBus tests (17 tests)

**Test Coverage**: 108 tests passing across 6 test files

---

## Future Work

### 1. Additional Test Coverage

**AgentStatusTracker** (no tests):
- `refreshStatus()`, `refreshDiffStats()`
- `updateAgentIcon()` (icon mapping)
- `getPendingApprovals()` / `getWaitingCount()`
- Event emission tests

**TmuxService** (only static analysis):
- `getSessionName()`, `sessionExists()`
- `killSession()` / `killContainerSession()`
- `listSessions()`

**Logger**: Log file writing, level filtering, child logger context

**Container Infrastructure**: ContainerManager, ContainerRegistry, ServiceContainer integration tests

---

### 2. Service Consolidation

VSCode services that should delegate to core via ServiceContainer:

| Service | Issue | Action |
|---------|-------|--------|
| TmuxService | Has TmuxServiceAdapter wrapper | Unify with core's ITmuxService |
| GitService | Uses CommandService | Use core's GitService via SystemAdapter |
| StatusService | Uses fs/agentPath directly | Use core's StatusService |
| Logger | Duplicate implementation | Use core's Logger |
| EventBus | Has fallback wrapper | Remove fallback, use ServiceContainer only |

---

### 3. CloudHypervisorAdapter Migration

**Current Location**: `packages/vscode/src/containers/CloudHypervisorAdapter.ts` (1,011 lines)

**Blocking Dependencies**:
1. `agentPath()` / `getHomeDir()` - WSL/Windows path conversion
2. `getConfigService()` - singleton pattern
3. `getLogger()` - singleton pattern
4. `ProxyManager` - internal vsock proxy class

**Migration Steps**:
1. Create `IPathAdapter` interface in core
2. Move `vsockProxy.ts` to core
3. Refactor CloudHypervisorAdapter to use injected dependencies
4. Create VSCodePathAdapter implementing IPathAdapter
5. Update ServiceContainer instantiation

---

### 4. Documentation Updates

**README.md**:
- Change `vscode-extension` → `packages/vscode`
- Update installation instructions for monorepo

**Architecture Docs**:
- Clarify AgentManager is VSCode-specific UI coordinator
- Document ServiceContainer as composition root
- Document singleton delegation pattern

---

### 5. Dead Code Cleanup (Low Priority)

Exports that exist in core but have no core usage:
- UIAdapter interface (only VSCode implements)
- PathContext type (internal to NodeSystemAdapter)
- QuickPickItem, InputOptions, ProgressOptions (UI types)

These are intentionally exported for implementers but could be moved to a separate `@opus-orchestra/core/ui` entry point.
