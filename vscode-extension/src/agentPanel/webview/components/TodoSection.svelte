<script lang="ts">
    import type { TodoItem } from '../stores';

    export let todos: TodoItem[];

    $: completedCount = todos.filter(t => t.status === 'completed').length;
    $: totalCount = todos.length;
    $: progressPercent = Math.round((completedCount / totalCount) * 100);

    function getIcon(status: string): string {
        switch (status) {
            case 'completed': return '✓';
            case 'in_progress': return '▶';
            default: return '○';
        }
    }

    function getText(item: TodoItem): string {
        return item.status === 'in_progress' && item.activeForm
            ? item.activeForm
            : item.content;
    }
</script>

<div class="todo-section">
    <div class="todo-header">
        <span class="todo-title">Tasks</span>
        <span class="todo-meta">{completedCount}/{totalCount} ({progressPercent}%)</span>
    </div>
    <ul class="todo-list">
        {#each todos as item}
            <li class="todo-item">
                <span class="todo-icon {item.status}">{getIcon(item.status)}</span>
                <div class="todo-content {item.status}">{getText(item)}</div>
            </li>
        {/each}
    </ul>
</div>

<style>
    .todo-section {
        margin-top: calc(12px * var(--ui-scale, 1));
        padding-top: calc(12px * var(--ui-scale, 1));
        border-top: 1px solid var(--vscode-panel-border, #454545);
    }

    .todo-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: calc(8px * var(--ui-scale, 1));
    }

    .todo-title {
        font-size: calc(11px * var(--ui-scale, 1));
        font-weight: 600;
        color: var(--vscode-descriptionForeground, #888);
        text-transform: uppercase;
    }

    .todo-meta {
        font-size: calc(10px * var(--ui-scale, 1));
        color: var(--vscode-descriptionForeground, #888);
    }

    .todo-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: calc(6px * var(--ui-scale, 1));
    }

    .todo-item {
        display: flex;
        align-items: flex-start;
        gap: calc(8px * var(--ui-scale, 1));
        font-size: calc(12px * var(--ui-scale, 1));
    }

    .todo-icon {
        width: calc(16px * var(--ui-scale, 1));
        height: calc(16px * var(--ui-scale, 1));
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: calc(10px * var(--ui-scale, 1));
        flex-shrink: 0;
        background: var(--vscode-badge-background, #4d4d4d);
    }

    .todo-icon.in_progress {
        background: var(--vscode-charts-blue, #3794ff);
        animation: pulse 1.5s ease-in-out infinite;
    }

    .todo-icon.completed {
        background: var(--vscode-charts-green, #89d185);
        color: #000;
    }

    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
    }

    .todo-content {
        flex: 1;
        color: var(--vscode-foreground, #cccccc);
    }

    .todo-content.in_progress {
        font-weight: 500;
    }

    .todo-content.completed {
        text-decoration: line-through;
        opacity: 0.6;
    }
</style>
