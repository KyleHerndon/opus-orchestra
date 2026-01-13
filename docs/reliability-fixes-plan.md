# Reliability Fixes Implementation Plan

## Overview
Fix reliability issues causing bugs in normal workflows. The existing state machine utilities are already defined but unused - we'll integrate them.

---

## Issue 1: Race Condition - Direct Agent Mutation During Polling

**Problem:** `AgentStatusTracker` mutates agent objects directly while concurrent polling loops run.

**Fix:** Use immutable updates - create new agent objects instead of mutating.

**Files:**
- `packages/core/src/managers/AgentStatusTracker.ts`

**Changes:**
```typescript
// Before (line 125-126):
agent.status = parsedStatus.status;
agent.pendingApproval = parsedStatus.pendingApproval;

// After: Return updated agent, let caller replace in map
private checkHookStatus(agent: Agent): Agent {
  const parsedStatus = this.statusService.checkStatus(agent.worktreePath);
  if (!parsedStatus) return agent;

  const updatedAgent = {
    ...agent,
    status: parsedStatus.status,
    pendingApproval: parsedStatus.pendingApproval,
  };

  if (agent.status !== updatedAgent.status) {
    this.eventBus.emit('agent:statusChanged', {
      agent: updatedAgent,
      previousStatus: agent.status
    });
  }
  return updatedAgent;
}
```

Apply same pattern to:
- `getDiffStatsAsync()` - return updated agent
- `refreshTodos()` - return updated agent
- `updateAgentIcon()` - return updated agent

---

## Issue 3: EventBus Swallows Handler Errors

**Problem:** Handler exceptions are logged but lost - no notification to system.

**Fix:** Emit error event when handlers fail.

**Files:**
- `packages/core/src/services/EventBus.ts`

**Changes:**
```typescript
emit<T extends EventType>(event: T, payload: EventPayloads[T]): void {
  const eventHandlers = this.handlers.get(event);
  if (!eventHandlers) return;

  for (const handler of eventHandlers) {
    try {
      handler(payload);
    } catch (error) {
      const err = error as Error;
      this.logger?.child('EventBus').error(`Error in handler for ${event}`, err);

      // Emit recoverable error event (avoid infinite loop by not emitting for error events)
      if (!event.startsWith('error:')) {
        this.emit('error:recoverable', {
          source: 'EventBus',
          code: 'HANDLER_ERROR',
          message: `Handler failed for event ${event}: ${err.message}`,
          context: { event, originalError: err.message },
        });
      }
    }
  }
}
```

---

## Issue 7: No Transaction Semantics for Multi-Field Updates

**Problem:** Status, approval, and icon changes emit separate events.

**Fix:** Bundle related changes into single update and emit once.

**Files:**
- `packages/core/src/managers/AgentStatusTracker.ts`

**Changes:**
Combine `checkHookStatus` and `updateAgentIcon` into single operation:

```typescript
private updateAgentFromStatus(agent: Agent): {
  updatedAgent: Agent;
  statusChanged: boolean;
  approvalChanged: boolean;
} {
  const parsedStatus = this.statusService.checkStatus(agent.worktreePath);

  let updatedAgent = agent;
  let statusChanged = false;
  let approvalChanged = false;

  if (parsedStatus) {
    statusChanged = agent.status !== parsedStatus.status;
    approvalChanged = (agent.pendingApproval === null) !== (parsedStatus.pendingApproval === null);

    updatedAgent = {
      ...agent,
      status: parsedStatus.status,
      pendingApproval: parsedStatus.pendingApproval,
    };
  }

  // Update icon based on new status
  const newIcon = this.computeIcon(updatedAgent);
  if (newIcon !== updatedAgent.statusIcon) {
    updatedAgent = { ...updatedAgent, statusIcon: newIcon };
  }

  return { updatedAgent, statusChanged, approvalChanged };
}
```

---

## Issue 10: No State Machine for Agent Lifecycle

**Problem:** No validation of agent state transitions. Agents can get stuck in invalid states.

**Fix:** Integrate the existing `createAgentStateMachine()` utility.

**Files:**
- `packages/core/src/managers/AgentStatusTracker.ts`

**Changes:**

1. Add agent state machines map to AgentStatusTracker:

```typescript
import { createAgentStateMachine, mapStatusToAgentEvent, AgentStatus } from '../types/stateMachines';
import { StateMachine } from '../utils/StateMachine';

export class AgentStatusTracker {
  private agentStateMachines: Map<number, StateMachine<AgentStatus, AgentEvent>> = new Map();

  private getStateMachine(agent: Agent): StateMachine<AgentStatus, AgentEvent> {
    let machine = this.agentStateMachines.get(agent.id);
    if (!machine) {
      machine = createAgentStateMachine(
        (from, to, event) => {
          this.logger?.debug(`Agent ${agent.name}: ${from} -> ${to} via ${event}`);
        },
        (state, event, allowed) => {
          this.logger?.warn(`Invalid transition for ${agent.name}: ${event} from ${state}`);
        }
      );
      if (agent.status !== 'idle') {
        machine.forceState(agent.status);
      }
      this.agentStateMachines.set(agent.id, machine);
    }
    return machine;
  }

  private validateAndApplyStatus(agent: Agent, newStatus: AgentStatus): AgentStatus {
    const machine = this.getStateMachine(agent);
    const event = mapStatusToAgentEvent(machine.state, newStatus);

    if (event && machine.canTransition(event)) {
      machine.transition(event);
      return newStatus;
    } else if (event) {
      this.logger?.warn(
        `Forcing state for ${agent.name}: ${machine.state} -> ${newStatus} (invalid transition)`
      );
      machine.forceState(newStatus);
      return newStatus;
    }
    return machine.state;
  }
}
```

2. Clean up state machines when agents are deleted:

```typescript
cleanupAgent(agentId: number): void {
  this.agentStateMachines.delete(agentId);
}
```

---

## All Issues Completed

- ~~Issue 1~~ (immutable updates) - Skipped, addressed by Issue 7
- ~~Issue 2~~ (selection index) - ID-based selection in App.tsx
- ~~Issue 3~~ (error events) - EventBus emits error:recoverable on handler failure
- ~~Issue 4~~ (FileWatcher for diffs) - Worktree watcher added
- ~~Issue 5~~ (sessionId) - No longer generates random UUIDs during polling
- ~~Issue 6~~ (debouncing) - Addressed by Issue 4
- ~~Issue 7~~ (transactions) - Combined updateAgentStatus does all mutations before events
- ~~Issue 8~~ (stale closures) - Uses agentsRef.current with empty deps
- ~~Issue 10~~ (state machine) - Agent status validated via createAgentStateMachine()

---

## Verification

### Manual Testing
1. Create 3 agents
2. Delete middle agent - verify selection moves correctly
3. Approve/reject actions work on correct agent
4. Edit a file in a worktree - verify diff stats update within ~1 second
5. No console errors about missing sessionId
6. Status transitions are logged correctly
