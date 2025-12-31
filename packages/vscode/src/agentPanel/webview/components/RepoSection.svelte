<script lang="ts">
    import type { Agent } from '../stores';
    import AgentCard from './AgentCard.svelte';
    import { vscode } from '../main';

    export let repoPath: string;
    export let repoIndex: number;
    export let agents: Agent[];

    $: repoName = repoPath.split(/[/\\]/).pop() || repoPath;
    $: hasAgents = agents.length > 0;

    function handleAddAgent() {
        vscode.postMessage({
            command: 'addAgentToRepo',
            repoIndex,
        });
    }
</script>

<div class="repo-section">
    <div class="repo-header">
        <div class="repo-title">
            {repoName}
            <span class="repo-path">{repoPath}</span>
        </div>
        <div class="repo-actions">
            <button
                class="btn btn-primary btn-small"
                on:click={handleAddAgent}
            >
                + Add Agent
            </button>
        </div>
    </div>
    <div class="agents-grid">
        {#if hasAgents}
            {#each agents as agent (agent.id)}
                <AgentCard {agent} />
            {/each}
        {:else}
            <div class="no-agents">
                No agents in this repository
            </div>
        {/if}
    </div>
</div>

<style>
    .repo-section {
        margin-bottom: calc(30px * var(--ui-scale, 1));
    }

    .repo-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: calc(15px * var(--ui-scale, 1));
        padding: calc(10px * var(--ui-scale, 1)) calc(15px * var(--ui-scale, 1));
        background: var(--vscode-sideBar-background, #252526);
        border-radius: calc(6px * var(--ui-scale, 1));
    }

    .repo-title {
        font-size: calc(14px * var(--ui-scale, 1));
        font-weight: 600;
        color: var(--vscode-foreground, #cccccc);
    }

    .repo-path {
        font-size: calc(11px * var(--ui-scale, 1));
        color: var(--vscode-descriptionForeground, #888);
        margin-left: calc(10px * var(--ui-scale, 1));
        font-family: var(--vscode-editor-font-family, monospace);
    }

    .agents-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(calc(280px * var(--ui-scale, 1)), 1fr));
        gap: calc(15px * var(--ui-scale, 1));
    }

    .no-agents {
        color: var(--vscode-descriptionForeground, #888);
        padding: calc(16px * var(--ui-scale, 1));
    }
</style>
