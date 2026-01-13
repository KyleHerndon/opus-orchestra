# Terminal UI for Opus Orchestra

## Overview

Create a new `packages/terminal` package that provides a terminal-based UI using **Ink** (React for CLI). The package will implement terminal-specific adapters and reuse all core business logic from `@opus-orchestra/core`.

## UI Design Philosophy

**Terminal-native design** - vertical lists with arrow key navigation, not grid layouts.

### Primary View: Simple List with Inline Expansion

```
┌─ Opus Orchestra ────────────────────────────────────────┐
│ Agents: 3 | Working: 1 | Waiting: 2 | +45/-12          │
├─────────────────────────────────────────────────────────┤
│ > alpha   WORKING          docker     +23/-5    5m     │
│     ├─ Todos: 2/5 ──────────────────────────────────   │
│     │  ○ Implement auth feature                        │
│     │  ▶ Writing unit tests                            │
│     │  ✓ Database migration complete                   │
│   bravo   WAITING-APPROVAL unisolated +12/-3    2m     │
│     └─ ⚠ Approval: Write to /src/api.ts               │
│        [a] Allow  [r] Reject  [v] View details         │
│   charlie IDLE             unisolated +10/-4    15m    │
├─────────────────────────────────────────────────────────┤
│ [↑↓] Navigate  [e] Expand  [E] All  [Enter] Focus  [?] │
└─────────────────────────────────────────────────────────┘
```

**Key behaviors:**
- Arrow keys navigate between agents
- `>` indicates selected agent
- Tree-like indentation for todos/approvals (terminal-native like `tree`)
- `e` toggles expand for selected agent
- `E` toggles expand all
- Collapsed: `alpha WORKING (3 todos) +23/-5`
- Approvals always visible inline under agent

### Multiple Views (number keys to switch)

1. **Agent List** (default) - main view above
2. **Diff View** (`d` or `2`) - scrollable git diff for selected agent
3. **Settings View** (`s` or `3`) - configuration options

### Diff View
```
┌─ Diff: alpha (claude-alpha) ────────────────────────────┐
│ 3 files changed, +23 insertions, -5 deletions          │
├─────────────────────────────────────────────────────────┤
│ diff --git a/src/auth.ts b/src/auth.ts                 │
│ @@ -12,6 +12,15 @@                                      │
│ +  if (!user.token) {                                  │
│ +    throw new AuthError('Missing token');             │
│ ... scrollable diff content ...                        │
├─────────────────────────────────────────────────────────┤
│ [↑↓] Scroll  [1] Back to list  [q] Quit                │
└─────────────────────────────────────────────────────────┘
```

### Future: List + Detail Split (optional enhancement)
```
┌─ Agents ───────────────┬─ Details ──────────────────────┐
│ > alpha   WORKING      │ Agent: alpha                   │
│   bravo   WAITING      │ Status: working (5m)           │
│   charlie IDLE         │ Changes: +23/-5 (3 files)      │
│                        │ Todos: 2/5 complete            │
│                        │ ▶ Writing unit tests           │
└────────────────────────┴────────────────────────────────┘
```
Component structure supports both layouts via composition.

## Package Structure

```
packages/terminal/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # Main entry point
│   ├── cli.ts                      # CLI argument parsing (commander)
│   │
│   ├── adapters/                   # Terminal-specific adapter implementations
│   │   ├── index.ts
│   │   ├── TerminalUIAdapter.ts    # UIAdapter using Ink prompts
│   │   ├── FileStorageAdapter.ts   # StorageAdapter using JSON files
│   │   ├── FileConfigAdapter.ts    # ConfigAdapter from config file
│   │   └── PTYTerminalAdapter.ts   # TerminalAdapter for tmux sessions
│   │
│   ├── components/                 # Ink React components
│   │   ├── App.tsx                 # Root application, view router
│   │   ├── views/
│   │   │   ├── AgentListView.tsx   # Main list view (default)
│   │   │   ├── DiffView.tsx        # Git diff viewer (scrollable)
│   │   │   └── SettingsView.tsx    # Configuration view
│   │   ├── AgentRow.tsx            # Single agent row (expandable)
│   │   ├── TodoList.tsx            # Expandable todo items
│   │   ├── ApprovalPrompt.tsx      # Inline approval with actions
│   │   ├── StatsBar.tsx            # Stats header bar
│   │   ├── StatusBadge.tsx         # Colored status indicator
│   │   ├── HelpBar.tsx             # Bottom keyboard shortcuts
│   │   └── LoadingIndicator.tsx    # Spinner/progress display
│   │
│   ├── hooks/                      # React hooks
│   │   ├── useAgents.ts            # Agent state subscription
│   │   ├── useEventBus.ts          # EventBus subscription
│   │   ├── useKeyboard.ts          # Keyboard shortcut handler
│   │   └── usePolling.ts           # Status polling
│   │
│   ├── services/
│   │   └── ServiceContainer.ts     # DI container for terminal
│   │
│   └── utils/
│       ├── formatting.ts           # Terminal text formatting
│       └── colors.ts               # Color definitions
│
├── bin/
│   └── opus.ts                     # Executable entry point
│
└── __tests__/
```

## CLI Commands

```bash
opus                          # Interactive dashboard (default)
opus status                   # Quick status summary (non-interactive)
opus agents list              # List agents (table format)
opus agents create [count]    # Create agents
opus agents focus <name>      # Attach to agent tmux session
opus config                   # Show current config
opus config set <key> <value> # Set config value
```

## Keyboard Shortcuts (Interactive Mode)

| Key | Action |
|-----|--------|
| `↑`/`↓` | Navigate between agents |
| `Enter` | Focus selected agent (attach tmux) |
| `e` | Expand/collapse selected agent |
| `E` | Expand/collapse all agents |
| `a` | Approve pending action |
| `r` | Reject pending action |
| `d` or `2` | Switch to diff view |
| `s` or `3` | Switch to settings view |
| `1` or `Esc` | Return to agent list |
| `c` | Create new agent |
| `x` | Delete selected agent |
| `?` | Show help |
| `q` | Quit |

## Key Dependencies

```json
{
  "dependencies": {
    "@opus-orchestra/core": "*",
    "ink": "^4.4.1",
    "ink-select-input": "^5.0.0",
    "ink-spinner": "^5.0.0",
    "ink-text-input": "^5.0.1",
    "react": "^18.2.0",
    "commander": "^12.0.0",
    "conf": "^12.0.0",
    "chalk": "^5.3.0"
  }
}
```

## Adapter Implementations

### 1. TerminalUIAdapter (implements UIAdapter)
- `showInfo/Warning/Error` → chalk-colored console output with optional action prompts
- `promptInput` → ink-text-input component
- `promptQuickPick` → ink-select-input component
- `confirm` → Yes/No selection
- `withProgress` → ink-spinner with message

### 2. FileStorageAdapter (implements StorageAdapter)
- Uses `conf` library for JSON file storage
- Location: `.opus-orchestra/storage.json` or `~/.config/opus-orchestra/storage.json`

### 3. FileConfigAdapter (implements ConfigAdapter)
- Reads from `.opus-orchestra/config.json` (project) or `~/.config/opus-orchestra/config.json` (user)
- Watches for file changes

### 4. PTYTerminalAdapter (implements TerminalAdapter)
- Primarily delegates to TmuxService from core
- `show()` attaches to tmux session (exits dashboard, returns with `opus`)

## Component Mapping (VS Code → Terminal)

| VS Code Svelte | Terminal Ink | Notes |
|----------------|--------------|-------|
| Dashboard.svelte | AgentListView.tsx | Vertical list, not grid |
| AgentCard.svelte | AgentRow.tsx | Single line, expandable |
| TodoSection.svelte | TodoList.tsx | Tree-indented under agent |
| ApprovalSection.svelte | ApprovalPrompt.tsx | Inline under agent row |
| LoadingIndicator.svelte | LoadingIndicator.tsx | Spinner |
| (multi-file diff) | DiffView.tsx | Scrollable diff viewer |
| (settings panel) | SettingsView.tsx | Config toggles |

## Implementation Steps

### Phase 1: Package Setup
1. Create `packages/terminal/` directory structure
2. Initialize `package.json` with Ink and dependencies
3. Configure `tsconfig.json` (JSX support for Ink)
4. Add to monorepo workspaces in root `package.json`
5. Create `bin/opus.ts` executable entry point

### Phase 2: Core Adapters
1. Implement `FileStorageAdapter` using `conf` library
2. Implement `FileConfigAdapter` with file watching
3. Implement `TerminalUIAdapter` (chalk messages, ink prompts)
4. Create `ServiceContainer` wiring core services with terminal adapters

### Phase 3: Basic CLI + List View
1. Set up Commander.js for CLI argument parsing
2. Create `App.tsx` root with view routing state
3. Implement `StatsBar.tsx` header component
4. Implement `AgentRow.tsx` - single agent line (collapsed state)
5. Implement `AgentListView.tsx` composing stats + rows
6. Add arrow key navigation between agents
7. Implement `HelpBar.tsx` for keyboard shortcuts

### Phase 4: Expansion & Todos
1. Add expand/collapse state to `AgentRow.tsx`
2. Implement `TodoList.tsx` with tree-indented display
3. Add `e` key to toggle expand selected agent
4. Add `E` key to toggle expand all agents
5. Show collapsed summary: `(3 todos)` when collapsed

### Phase 5: Approvals & Actions
1. Implement `ApprovalPrompt.tsx` inline under agent
2. Add `a` key to approve, `r` key to reject
3. Implement agent focus (attach to tmux, exit dashboard)
4. Add `x` key for delete with confirmation
5. Add `c` key for create agent flow

### Phase 6: Additional Views
1. Implement `DiffView.tsx` - scrollable git diff
2. Add `d` or `2` to switch to diff view
3. Implement `SettingsView.tsx` - config display/toggle
4. Add `s` or `3` to switch to settings view
5. Add `1` or `Esc` to return to list view

### Phase 7: Polish & Testing
1. Real-time status polling with usePolling hook
2. Error handling and edge cases
3. Help screen (`?` key) with full keyboard reference
4. Loading states during operations
5. Unit tests for adapters and hooks

## Critical Files to Reference

- `packages/core/src/adapters/UIAdapter.ts` - Interface to implement
- `packages/vscode/src/ServiceContainer.ts` - DI pattern to follow
- `packages/vscode/src/agentPanel/webview/components/AgentCard.svelte` - UI structure
- `packages/core/src/managers/AgentStatusTracker.ts` - Reuse directly
- `packages/core/src/services/TmuxService.ts` - Terminal session management

## Verification

1. **Build**: `npm run build -w @opus-orchestra/terminal`
2. **Unit tests**: `npm run test -w @opus-orchestra/terminal`
3. **Manual testing**:
   - Run `opus` from a git repo with existing agents
   - Create new agents via `c` key
   - Focus agent and verify tmux attachment
   - Verify status polling updates display
   - Test approval flow if agents have pending requests
