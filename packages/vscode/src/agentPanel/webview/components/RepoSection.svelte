<script lang="ts">
    import type { Agent } from '../stores';
    import { containerGroups } from '../stores';
    import AgentCard from './AgentCard.svelte';
    import { vscode } from '../main';

    export let repoPath: string;
    export let repoIndex: number;
    export let agents: Agent[];

    $: repoName = repoPath.split(/[/\\]/).pop() || repoPath;
    $: hasAgents = agents.length > 0;

    let selectedContainer = 'unisolated';
    let agentCount = 3;

    function handleAddAgent() {
        vscode.postMessage({
            command: 'addAgentToRepo',
            repoIndex,
        });
    }

    function handleCreateAgents() {
        vscode.postMessage({
            command: 'createAgents',
            repoIndex,
            containerConfigName: selectedContainer,
            count: agentCount,
        });
    }
</script>

<div class="repo-section">
    <div class="repo-header">
        <div class="repo-title">
            {repoName}
            <span class="repo-path">{repoPath}</span>
        </div>
        {#if hasAgents}
            <div class="repo-actions">
                <button
                    class="btn btn-primary btn-small"
                    on:click={handleAddAgent}
                >
                    + Add Agent
                </button>
            </div>
        {/if}
    </div>
    <div class="agents-grid">
        {#if hasAgents}
            {#each agents as agent (agent.id)}
                <AgentCard {agent} />
            {/each}
        {:else}
            <div class="create-agents-card">
                <div class="create-agents-title">Create Agents</div>
                <div class="create-agents-form">
                    <div class="form-row">
                        <label for="container-{repoIndex}">Container:</label>
                        <select
                            id="container-{repoIndex}"
                            bind:value={selectedContainer}
                            class="tier-select"
                        >
                            {#each $containerGroups as group}
                                {#if group.label}
                                    <optgroup label={group.label}>
                                        {#each group.options as option}
                                            <option value={option.value}>{option.label}</option>
                                        {/each}
                                    </optgroup>
                                {:else}
                                    {#each group.options as option}
                                        <option value={option.value}>{option.label}</option>
                                    {/each}
                                {/if}
                            {/each}
                        </select>
                    </div>
                    <div class="form-row">
                        <label for="count-{repoIndex}">Count:</label>
                        <input
                            id="count-{repoIndex}"
                            type="number"
                            bind:value={agentCount}
                            min="1"
                            max="10"
                            class="count-input"
                        />
                    </div>
                    <button class="btn btn-primary" on:click={handleCreateAgents}>
                        Create {agentCount} Agent{agentCount !== 1 ? 's' : ''}
                    </button>
                </div>
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

    .create-agents-card {
        background: var(--vscode-editor-background, #1e1e1e);
        border: 1px dashed var(--vscode-input-border, #454545);
        border-radius: calc(8px * var(--ui-scale, 1));
        padding: calc(20px * var(--ui-scale, 1));
        display: flex;
        flex-direction: column;
        gap: calc(15px * var(--ui-scale, 1));
        min-width: calc(280px * var(--ui-scale, 1));
    }

    .create-agents-title {
        font-size: calc(14px * var(--ui-scale, 1));
        font-weight: 600;
        color: var(--vscode-foreground, #cccccc);
    }

    .create-agents-form {
        display: flex;
        flex-direction: column;
        gap: calc(12px * var(--ui-scale, 1));
    }

    .form-row {
        display: flex;
        align-items: center;
        gap: calc(10px * var(--ui-scale, 1));
    }

    .form-row label {
        font-size: calc(12px * var(--ui-scale, 1));
        color: var(--vscode-descriptionForeground, #888);
        min-width: calc(70px * var(--ui-scale, 1));
    }

    .form-row select,
    .form-row input {
        flex: 1;
    }

    .count-input {
        background: var(--vscode-input-background, #3c3c3c);
        color: var(--vscode-input-foreground, #cccccc);
        border: 1px solid var(--vscode-input-border, #454545);
        border-radius: calc(4px * var(--ui-scale, 1));
        padding: calc(6px * var(--ui-scale, 1)) calc(8px * var(--ui-scale, 1));
        font-size: calc(12px * var(--ui-scale, 1));
        width: calc(60px * var(--ui-scale, 1));
    }

    .count-input:focus {
        outline: 1px solid var(--vscode-focusBorder, #007fd4);
    }
</style>
