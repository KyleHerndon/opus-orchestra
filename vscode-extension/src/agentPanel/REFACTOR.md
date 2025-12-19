# AgentPanel Svelte Refactoring

## Status: COMPLETED

The AgentPanel has been refactored from a monolithic TypeScript file (~2000 lines) to a Svelte-based architecture.

## Why Svelte?

User priorities: **Speed first, then memory**

- **Speed priority**: No virtual DOM, compiles to direct DOM manipulations
- **Memory priority**: ~1.6KB runtime, no vDOM tree in memory
- **Reactive updates**: Fine-grained reactivity without diffing
- **Built-in CSS**: Scoped styles with zero runtime cost

## Architecture

```
src/agentPanel/
├── AgentPanel.ts          # Extension-side controller (message handling, VS Code API)
├── types.ts               # Shared type definitions for messages
├── index.ts               # Module exports
├── build.js               # esbuild + Svelte compilation script
└── webview/
    ├── main.ts            # Webview entry point, message bridge
    ├── stores.ts          # Svelte stores for reactive state
    ├── App.svelte         # Root component with global styles
    └── components/
        ├── Dashboard.svelte      # Main dashboard with stats bar
        ├── RepoSection.svelte    # Repository grouping
        ├── AgentCard.svelte      # Individual agent card
        ├── TodoSection.svelte    # TODO list display
        ├── ApprovalSection.svelte # Permission approval UI
        ├── EmptyState.svelte     # No-agents create form
        └── LoadingIndicator.svelte # Loading overlay
```

## Message Flow

1. **Extension → Webview**: `AgentPanel._postMessage()` sends typed messages
2. **Webview receives**: `main.ts` handles messages, updates Svelte stores
3. **Svelte reacts**: Components automatically re-render based on store changes
4. **Webview → Extension**: Components call `vscode.postMessage()` for actions
5. **Extension handles**: `AgentPanel._handleMessage()` processes user actions

## Build Process

```bash
# Compile TypeScript AND Svelte webview
npm run compile

# Watch mode for development
npm run watch:webview
```

The build script (`build.js`) uses esbuild with esbuild-svelte plugin to:
1. Bundle `webview/main.ts` as entry point
2. Compile Svelte components to vanilla JS
3. Inject component CSS into the bundle
4. Output to `out/webview/agentPanel.js`

## Key Design Decisions

1. **Global styles in App.svelte**: Using `:global()` for shared styles since component scoping isn't needed for this single-page webview

2. **Stores for state**: Svelte stores (`writable`, `derived`) manage reactive state that flows to components

3. **No external CSS files**: All styles are inlined in App.svelte using `:global()` selectors

4. **Type-safe messages**: `types.ts` defines interfaces for all message shapes

## Event-Driven Architecture

From CLAUDE.md - NEVER call full re-renders except on initial load.
All updates use incremental postMessage updates:
- `addCard`: Insert new agent card
- `removeCard`: Remove agent card
- `updateAgents`: Update status/stats/todos/approval in place
- `swapCards`: Reorder for drag/drop
- `updateContainerOptions`: Update dropdowns

## Testing

Static analysis tests in `agentPanel.test.ts` verify:
- All required actions exist in components
- Message handlers are in sync between extension and webview
- Required UI elements (rename input, drag support, etc.) exist
