<script lang="ts">
    import type { Agent } from '../stores';
    import { containerGroups } from '../stores';
    import { vscode } from '../main';
    import TodoSection from './TodoSection.svelte';
    import ApprovalSection from './ApprovalSection.svelte';

    export let agent: Agent;

    // Computed properties
    $: isWaiting = agent.status === 'waiting-input' || agent.status === 'waiting-approval';
    $: needsApproval = agent.status === 'waiting-approval';
    $: statusClass = agent.status === 'working' ? 'status-working'
        : isWaiting ? 'status-waiting'
        : agent.status === 'stopped' ? 'status-stopped'
        : agent.status === 'error' ? 'status-error'
        : 'status-idle';

    $: configName = agent.containerConfigName || 'unisolated';
    $: isContainerized = configName !== 'unisolated';
    $: containerState = agent.containerInfo?.state || 'not_created';

    $: timeSince = formatTimeSince(agent.lastInteractionTime);
    $: hasTodos = agent.todoItems && agent.todoItems.length > 0;

    // Format time since last interaction
    function formatTimeSince(timestamp: number): string {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h`;
        const days = Math.floor(hours / 24);
        return `${days}d`;
    }

    // Event handlers
    function handleFocus() {
        vscode.postMessage({ command: 'focus', agentId: agent.id });
    }

    function handleStartClaude() {
        vscode.postMessage({ command: 'startClaude', agentId: agent.id });
    }

    function handleDelete() {
        vscode.postMessage({ command: 'deleteAgent', agentId: agent.id });
    }

    function handleViewDiff() {
        vscode.postMessage({ command: 'viewDiff', agentId: agent.id });
    }

    function handleConfigChange(event: Event) {
        const select = event.target as HTMLSelectElement;
        vscode.postMessage({
            command: 'changeContainerConfig',
            agentId: agent.id,
            configName: select.value,
        });
    }

    function handleRename(event: Event) {
        const input = event.target as HTMLInputElement;
        const newName = input.value.trim();
        const originalName = input.dataset.original;

        if (newName && newName !== originalName) {
            vscode.postMessage({
                command: 'renameAgent',
                agentId: agent.id,
                newName,
            });
            input.dataset.original = newName;
        } else {
            input.value = originalName || '';
        }
    }

    // Drag and drop
    let isDragging = false;
    let dragOverPosition: 'left' | 'right' | null = null;

    function handleDragStart(event: DragEvent) {
        isDragging = true;
        event.dataTransfer?.setData('text/plain', String(agent.id));
    }

    function handleDragEnd() {
        isDragging = false;
    }

    function handleDragOver(event: DragEvent) {
        event.preventDefault();
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const midpoint = rect.left + rect.width / 2;
        dragOverPosition = event.clientX < midpoint ? 'left' : 'right';
    }

    function handleDragLeave() {
        dragOverPosition = null;
    }

    function handleDrop(event: DragEvent) {
        event.preventDefault();
        dragOverPosition = null;
        const sourceId = event.dataTransfer?.getData('text/plain');
        if (sourceId && sourceId !== String(agent.id)) {
            vscode.postMessage({
                command: 'reorderAgents',
                sourceAgentId: parseInt(sourceId, 10),
                targetAgentId: agent.id,
                dropPosition: dragOverPosition,
            });
        }
    }
</script>

<div
    class="agent-card"
    class:waiting={isWaiting}
    class:containerized={isContainerized}
    class:dragging={isDragging}
    class:drag-over-left={dragOverPosition === 'left'}
    class:drag-over-right={dragOverPosition === 'right'}
    draggable="true"
    data-agent-id={agent.id}
    data-repo-path={agent.repoPath}
    on:dragstart={handleDragStart}
    on:dragend={handleDragEnd}
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:drop={handleDrop}
>
    <div class="agent-header">
        <div style="display: flex; align-items: center; gap: 8px;">
            <input
                type="text"
                class="agent-title-input"
                value={agent.name}
                data-agent-id={agent.id}
                data-original={agent.name}
                title="Click to rename"
                on:blur={handleRename}
                on:keydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            {#if isContainerized}
                <span class="container-state {containerState}">{containerState}</span>
            {/if}
        </div>
        <span class="agent-status {statusClass}">{agent.status}</span>
    </div>

    <div class="agent-stats">
        <div class="stat-item">
            <span class="stat-label">{agent.status === 'working' ? 'Working' : 'Waiting'}</span>
            <span class="stat-value">{timeSince}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Changes</span>
            <div class="diff-stats">
                <span class="diff-add">+{agent.diffStats.insertions}</span>
                <span class="diff-del">-{agent.diffStats.deletions}</span>
                <button class="btn-icon" on:click={handleViewDiff} title="View diff">📄</button>
            </div>
        </div>
    </div>

    <div class="agent-actions">
        <button class="btn btn-small btn-primary" on:click={handleFocus}>
            {agent.hasTerminal ? 'Focus Terminal' : 'Open Terminal'}
        </button>
        <button class="btn btn-small btn-primary" on:click={handleStartClaude}>
            Start Claude
        </button>
        <select
            class="tier-select tier-select-small"
            value={configName}
            on:change={handleConfigChange}
            title="Change container config"
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
        <button class="btn btn-small btn-danger" on:click={handleDelete} title="Delete agent">
            🗑️
        </button>
    </div>

    {#if hasTodos}
        <TodoSection todos={agent.todoItems} />
    {/if}

    {#if needsApproval}
        <ApprovalSection agentId={agent.id} context={agent.pendingApproval} />
    {/if}
</div>

<style>
    .agent-card {
        background: var(--vscode-editor-background, #1e1e1e);
        border: 1px solid var(--vscode-panel-border, #454545);
        border-radius: calc(8px * var(--ui-scale, 1));
        padding: calc(15px * var(--ui-scale, 1));
        transition: border-color 0.2s, box-shadow 0.2s;
    }

    .agent-card:hover {
        border-color: var(--vscode-focusBorder, #007fd4);
    }

    .agent-card.waiting {
        border-color: var(--vscode-charts-yellow, #cca700);
        box-shadow: 0 0 10px rgba(204, 167, 0, 0.2);
    }

    .agent-card.containerized {
        border-left: 3px solid var(--vscode-charts-blue, #3794ff);
    }

    .agent-card.dragging {
        opacity: 0.5;
        border-style: dashed;
    }

    .agent-card.drag-over-left {
        border-left: 3px solid var(--vscode-focusBorder, #007fd4);
    }

    .agent-card.drag-over-right {
        border-right: 3px solid var(--vscode-focusBorder, #007fd4);
    }

    .agent-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: calc(12px * var(--ui-scale, 1));
    }

    .agent-title-input {
        font-size: calc(16px * var(--ui-scale, 1));
        font-weight: 600;
        background: transparent;
        border: none;
        color: var(--vscode-foreground, #cccccc);
        padding: calc(2px * var(--ui-scale, 1)) calc(4px * var(--ui-scale, 1));
        border-radius: calc(3px * var(--ui-scale, 1));
        width: auto;
        min-width: calc(80px * var(--ui-scale, 1));
    }

    .agent-title-input:hover {
        background: var(--vscode-input-background, #3c3c3c);
    }

    .agent-title-input:focus {
        outline: 1px solid var(--vscode-focusBorder, #007fd4);
        background: var(--vscode-input-background, #3c3c3c);
    }

    .agent-status {
        font-size: calc(11px * var(--ui-scale, 1));
        padding: calc(3px * var(--ui-scale, 1)) calc(8px * var(--ui-scale, 1));
        border-radius: calc(10px * var(--ui-scale, 1));
        text-transform: uppercase;
        font-weight: 500;
    }

    .status-working {
        background: var(--vscode-charts-green, #89d185);
        color: #000;
    }

    .status-waiting {
        background: var(--vscode-charts-yellow, #cca700);
        color: #000;
    }

    .status-stopped {
        background: var(--vscode-charts-red, #f14c4c);
        color: #fff;
    }

    .status-idle {
        background: var(--vscode-badge-background, #4d4d4d);
        color: var(--vscode-badge-foreground, #fff);
    }

    .status-error {
        background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
        color: #fff;
    }

    .container-state {
        font-size: calc(10px * var(--ui-scale, 1));
        padding: calc(2px * var(--ui-scale, 1)) calc(6px * var(--ui-scale, 1));
        border-radius: calc(8px * var(--ui-scale, 1));
        text-transform: uppercase;
    }

    .container-state.running {
        background: var(--vscode-charts-green, #89d185);
        color: #000;
    }

    .container-state.stopped,
    .container-state.not_created {
        background: var(--vscode-badge-background, #4d4d4d);
        color: var(--vscode-badge-foreground, #fff);
    }

    .agent-stats {
        display: flex;
        gap: calc(20px * var(--ui-scale, 1));
        margin-bottom: calc(12px * var(--ui-scale, 1));
        font-size: calc(12px * var(--ui-scale, 1));
    }

    .stat-item {
        display: flex;
        flex-direction: column;
        gap: calc(2px * var(--ui-scale, 1));
    }

    .stat-label {
        font-size: calc(11px * var(--ui-scale, 1));
        color: var(--vscode-descriptionForeground, #888);
        text-transform: uppercase;
    }

    .stat-value {
        color: var(--vscode-foreground, #cccccc);
    }

    .agent-actions {
        display: flex;
        gap: calc(8px * var(--ui-scale, 1));
        flex-wrap: wrap;
    }
</style>
