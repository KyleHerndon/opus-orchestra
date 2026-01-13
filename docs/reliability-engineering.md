# Reliability Engineering Guide

This document captures lessons learned and strategies for catching bugs before they reach users.

## Bugs We've Seen and How to Prevent Them

### 1. Session Name Mismatch (Terminal Reopening Bug)

**What happened**: Sessions were created with agent name but looked up with sessionId, causing "cannot reopen" failures.

**Root cause**: Two code paths (creation vs lookup) evolved independently without a shared abstraction.

**Prevention**:
- **Single source of truth**: Session naming should go through ONE function (`TmuxService.getSessionName()`)
- **Integration test**: Test the full create → close → reopen cycle
- **Code review checkpoint**: Any PR touching session/terminal code should trace both creation AND lookup paths

### 2. Silent Error Handling

**What happened**: Catch blocks returned default values without logging, making debugging impossible.

**Root cause**: Defensive coding ("don't crash") without considering observability.

**Prevention**:
- **Linting rule**: Empty catch blocks should trigger warnings
- **Code review checkpoint**: Every catch block must either re-throw, log, or have a comment explaining why silence is intentional
- **Logging levels**: Use WARN for "something failed but we recovered", DEBUG for "expected condition"

### 3. Missing Validation

**What happened**: `loadAgentMetadata()` accepted any JSON, causing crashes when fields were missing.

**Root cause**: TypeScript's `as Type` casting provides no runtime protection.

**Prevention**:
- **Validation functions**: Every `JSON.parse()` followed by `as Type` needs a runtime validator
- **Schema validation**: Consider zod or similar for critical data structures
- **Test with malformed data**: Include tests with missing/invalid fields

### 4. Code Duplication Drift

**What happened**: VSCode and terminal packages had duplicate service implementations that diverged over time.

**Root cause**: Copy-paste during initial development, no process to consolidate.

**Prevention**:
- **Single package for shared code**: Everything in `packages/core`
- **Import audit**: Periodic check that packages import from core, not implement locally
- **PR template question**: "Does this duplicate existing code in another package?"

---

## Critical User Workflows to Test

These workflows represent the most common user journeys. Each should have end-to-end test coverage.

### Workflow 1: First-Time Setup
```
1. User runs `opus` in a git repo for first time
2. Dashboard shows empty state
3. User creates first agent
4. Agent appears in dashboard with correct status
5. User can focus the agent terminal
```

**Test file**: `workflows.e2e.test.ts` - "Fresh Project Setup Workflow"

### Workflow 2: Agent Lifecycle
```
1. Create agent
2. Focus agent (opens terminal/tmux session)
3. Work in terminal (Claude runs)
4. Detach/close terminal
5. Reopen terminal (should resume, not restart)
6. Delete agent (cleanup worktree, branch, session)
```

**Test file**: `cli.integration.test.ts` - covers most of this, but missing the "reopen" step

**GAP IDENTIFIED**: No test for step 5 (reopen after close)

### Workflow 3: Multi-Agent Coordination
```
1. Create multiple agents
2. Each agent works on different branch
3. Switch between agents
4. Delete one agent while others continue
5. No interference between agents
```

**Test file**: `workflows.e2e.test.ts` - "should handle multiple agents independently"

### Workflow 4: Persistence Across Restarts
```
1. Create agents
2. Exit opus
3. Restart opus
4. Agents are restored with correct state
5. Can focus restored agents
```

**Test file**: `dashboard-flow.integration.test.ts` partially covers this

**GAP IDENTIFIED**: Need explicit restart simulation test

### Workflow 5: Error Recovery
```
1. Corrupt agent metadata file
2. Start opus
3. Should warn about corrupt agent, continue with others
4. Should not crash
```

**GAP IDENTIFIED**: No test for graceful degradation with corrupt data

---

## Testing Strategy

### Test Pyramid

```
                    /\
                   /  \  E2E Tests (slow, few)
                  /----\  - Full user workflows
                 /      \ - Real git operations
                /--------\  Integration Tests (medium)
               /          \ - Component interactions
              /            \ - Mock external deps
             /--------------\  Unit Tests (fast, many)
            /                \ - Single function/class
           /                  \ - Mock everything
          ----------------------
```

### What Each Level Should Test

**Unit Tests** (`*.test.ts`):
- Pure functions (validation, parsing, formatting)
- Single class methods in isolation
- Edge cases and error conditions
- Fast (<10ms per test)

**Integration Tests** (`*.integration.test.ts`):
- Service interactions (e.g., TmuxService + TmuxTerminalAdapter)
- File system operations with temp directories
- CLI command parsing and output
- Medium speed (<5s per test)

**E2E Tests** (`*.e2e.test.ts`):
- Full user workflows
- Real git operations
- Real file system
- Slow but comprehensive (<30s per test)

### Test Requirements for PRs

Before merging, PRs should have:

1. **New feature**: At least one integration test covering the happy path
2. **Bug fix**: A regression test that would have caught the bug
3. **Refactor**: Existing tests still pass (no new tests required)

---

## Code Review Checklist

### Error Handling
- [ ] No empty catch blocks (log or comment explaining silence)
- [ ] Errors logged at appropriate level (ERROR for bugs, WARN for recoverable, DEBUG for expected)
- [ ] User-facing errors have actionable messages

### Data Validation
- [ ] External data (JSON, user input) validated before use
- [ ] TypeScript `as Type` casts have runtime validators
- [ ] Null/undefined handled explicitly

### State Management
- [ ] Persistence operations are atomic (no partial writes)
- [ ] State can be recovered after crash
- [ ] Concurrent access handled (or documented as not supported)

### Cross-Package Impact
- [ ] Changes in core don't break vscode/terminal packages
- [ ] Shared interfaces updated in core, not duplicated
- [ ] Version compatibility considered

### Session/Terminal Operations
- [ ] Session names derived from single source (TmuxService.getSessionName)
- [ ] Session lifecycle tested: create → use → close → reopen → delete
- [ ] Cleanup happens on all exit paths

---

## Gaps to Address

Based on this analysis, here are specific improvements to make:

### High Priority

1. **Add "reopen after close" test**
   - Location: `packages/terminal/src/__tests__/cli.integration.test.ts`
   - Test: Create agent, focus, detach, focus again, verify same session

2. **Add corrupt data handling test**
   - Location: `packages/core/src/__tests__/managers/WorktreeManager.test.ts`
   - Test: Load metadata with missing required fields, verify graceful skip

3. **Add restart persistence test**
   - Location: `packages/terminal/src/__tests__/workflows.e2e.test.ts`
   - Test: Create agents, simulate restart, verify restoration

### Medium Priority

4. **ESLint rule for empty catch blocks**
   - Add `no-empty` rule or custom rule requiring comment/log

5. **Validation library adoption**
   - Consider zod for PersistedAgent, ExtensionConfig, HookData

6. **Import audit script**
   - Script to detect when vscode/terminal import from local instead of core

### Low Priority

7. **Pre-commit hooks**
   - Run type checking and linting before commit
   - Run affected tests before push

8. **Test coverage tracking**
   - Set up coverage reporting
   - Identify untested code paths

---

## Quick Reference: Where to Add Tests

| Bug Type | Test Location | Test Type |
|----------|---------------|-----------|
| Parsing/validation | `core/__tests__/` | Unit |
| Service interaction | `core/__tests__/services/` | Integration |
| CLI command | `terminal/__tests__/cli.integration.test.ts` | Integration |
| User workflow | `terminal/__tests__/workflows.e2e.test.ts` | E2E |
| VSCode UI | `vscode/test/suite/` | Unit |
| Session management | `terminal/__tests__/TmuxTerminalAdapter.test.ts` | Integration |

---

## Metrics to Track

1. **Bugs found in production vs testing**: Goal is to shift left
2. **Test execution time**: Keep CI fast (<5 min)
3. **Flaky test rate**: Should be <1%
4. **Code coverage**: Track trends, not absolute numbers
