<script lang="ts">
    import { repoPaths, containerGroups } from '../stores';
    import { vscode } from '../main';

    let selectedRepoIndex = 0;
    let selectedContainer = 'unisolated';
    let agentCount = 3;

    $: defaultRepo = $repoPaths.length > 0 ? $repoPaths[0] : 'No repository configured';
    $: repoName = defaultRepo.split(/[/\\]/).pop() || defaultRepo;
    $: hasMultipleRepos = $repoPaths.length > 1;

    function handleCreate() {
        vscode.postMessage({
            command: 'createAgents',
            repoIndex: selectedRepoIndex,
            containerConfigName: selectedContainer,
            count: agentCount,
        });
    }
</script>

<div class="empty-state">
    <h2 class="empty-title">No Agents Created</h2>
    <p class="empty-description">Create agent worktrees to start running multiple Claude instances in parallel.</p>

    <div class="create-form">
        {#if hasMultipleRepos}
            <div class="form-group">
                <label for="repo-select">Repository:</label>
                <select id="repo-select" bind:value={selectedRepoIndex}>
                    {#each $repoPaths as path, i}
                        <option value={i}>{path.split(/[/\\]/).pop()}</option>
                    {/each}
                </select>
            </div>
        {:else}
            <div class="form-group">
                <span class="repo-info">
                    Repository: <strong>{repoName}</strong>
                </span>
            </div>
        {/if}

        <div class="form-group">
            <label for="container-select">Container:</label>
            <select id="container-select" bind:value={selectedContainer} class="tier-select">
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

        <div class="form-group">
            <label for="agent-count">Number of agents:</label>
            <input
                id="agent-count"
                type="number"
                bind:value={agentCount}
                min="1"
                max="10"
            />
        </div>

        <button class="btn btn-primary" on:click={handleCreate}>
            Create Agents
        </button>
    </div>
</div>

<style>
    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: calc(400px * var(--ui-scale, 1));
        text-align: center;
    }

    .empty-title {
        font-size: calc(20px * var(--ui-scale, 1));
        font-weight: 600;
        margin: 0 0 calc(10px * var(--ui-scale, 1)) 0;
        color: var(--vscode-foreground, #cccccc);
    }

    .empty-description {
        font-size: calc(14px * var(--ui-scale, 1));
        color: var(--vscode-descriptionForeground, #888);
        margin: 0 0 calc(30px * var(--ui-scale, 1)) 0;
        max-width: calc(400px * var(--ui-scale, 1));
    }

    .create-form {
        display: flex;
        flex-direction: column;
        gap: calc(15px * var(--ui-scale, 1));
        width: calc(300px * var(--ui-scale, 1));
    }

    .form-group {
        display: flex;
        flex-direction: column;
        gap: calc(5px * var(--ui-scale, 1));
        text-align: left;
    }

    .form-group label {
        font-size: calc(12px * var(--ui-scale, 1));
        color: var(--vscode-descriptionForeground, #888);
    }

    .form-group select,
    .form-group input {
        background: var(--vscode-input-background, #3c3c3c);
        color: var(--vscode-input-foreground, #cccccc);
        border: 1px solid var(--vscode-input-border, #454545);
        border-radius: calc(4px * var(--ui-scale, 1));
        padding: calc(8px * var(--ui-scale, 1));
        font-size: calc(13px * var(--ui-scale, 1));
    }

    .form-group input:focus,
    .form-group select:focus {
        outline: 1px solid var(--vscode-focusBorder, #007fd4);
    }

    .repo-info {
        color: var(--vscode-descriptionForeground, #888);
    }

    .repo-info strong {
        color: var(--vscode-foreground, #cccccc);
    }
</style>
