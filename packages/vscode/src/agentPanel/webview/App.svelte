<script lang="ts">
    import { agents, loading, uiScale } from './stores';
    import Dashboard from './components/Dashboard.svelte';
    import EmptyState from './components/EmptyState.svelte';
    import LoadingIndicator from './components/LoadingIndicator.svelte';

    $: hasAgents = $agents.size > 0;
</script>

<div class="app" style="--ui-scale: {$uiScale};">
    {#if $loading.active}
        <LoadingIndicator
            message={$loading.message}
            current={$loading.current}
            total={$loading.total}
        />
    {/if}

    {#if hasAgents}
        <Dashboard />
    {:else}
        <EmptyState />
    {/if}
</div>

<style>
    /* Base styles - truly global */
    :global(*) {
        box-sizing: border-box;
    }

    :global(body) {
        font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        font-size: calc(var(--vscode-font-size, 13px) * var(--ui-scale, 1));
        color: var(--vscode-foreground, #cccccc);
        background-color: var(--vscode-editor-background, #1e1e1e);
        margin: 0;
        padding: calc(20px * var(--ui-scale, 1));
    }

    .app {
        width: 100%;
        min-height: 100vh;
    }

    /* Shared button styles */
    :global(.btn) {
        padding: calc(6px * var(--ui-scale, 1)) calc(12px * var(--ui-scale, 1));
        border: none;
        border-radius: calc(4px * var(--ui-scale, 1));
        cursor: pointer;
        font-size: calc(12px * var(--ui-scale, 1));
        transition: opacity 0.2s;
    }

    :global(.btn:hover) {
        opacity: 0.9;
    }

    :global(.btn-primary) {
        background: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #fff);
    }

    :global(.btn-secondary) {
        background: var(--vscode-button-secondaryBackground, #3a3d41);
        color: var(--vscode-button-secondaryForeground, #fff);
    }

    :global(.btn-danger) {
        background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
        color: #fff;
    }

    :global(.btn-muted) {
        background: var(--vscode-button-secondaryBackground, #3a3d41);
        color: var(--vscode-descriptionForeground, #888);
    }

    :global(.btn-small) {
        padding: calc(4px * var(--ui-scale, 1)) calc(8px * var(--ui-scale, 1));
        font-size: calc(11px * var(--ui-scale, 1));
    }

    :global(.btn-icon) {
        background: transparent;
        border: none;
        cursor: pointer;
        padding: calc(4px * var(--ui-scale, 1));
        font-size: calc(14px * var(--ui-scale, 1));
        opacity: 0.7;
    }

    :global(.btn-icon:hover) {
        opacity: 1;
    }

    /* Shared dropdown styles */
    :global(.tier-select) {
        background: var(--vscode-dropdown-background, #3c3c3c);
        color: var(--vscode-dropdown-foreground, #cccccc);
        border: 1px solid var(--vscode-dropdown-border, #454545);
        border-radius: calc(4px * var(--ui-scale, 1));
        padding: calc(4px * var(--ui-scale, 1)) calc(8px * var(--ui-scale, 1));
        font-size: calc(11px * var(--ui-scale, 1));
        cursor: pointer;
    }

    :global(.tier-select-small) {
        padding: calc(3px * var(--ui-scale, 1)) calc(6px * var(--ui-scale, 1));
        font-size: calc(10px * var(--ui-scale, 1));
    }

    /* Shared diff stats */
    :global(.diff-stats) {
        display: flex;
        gap: calc(8px * var(--ui-scale, 1));
        align-items: center;
    }

    :global(.diff-add) {
        color: var(--vscode-gitDecoration-addedResourceForeground, #89d185);
    }

    :global(.diff-del) {
        color: var(--vscode-gitDecoration-deletedResourceForeground, #f14c4c);
    }
</style>
