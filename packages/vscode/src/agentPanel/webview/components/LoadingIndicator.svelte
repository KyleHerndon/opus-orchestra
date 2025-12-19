<script lang="ts">
    export let message: string;
    export let current: number | undefined = undefined;
    export let total: number | undefined = undefined;

    $: hasProgress = current !== undefined && total !== undefined && total > 0;
    $: percent = hasProgress ? Math.round((current! / total!) * 100) : 0;
</script>

<div class="loading-overlay">
    <div class="loading-spinner"></div>
    <div class="loading-content">
        <div class="loading-message">{message}</div>
        {#if hasProgress}
            <div class="loading-progress">
                <div class="loading-bar">
                    <div class="loading-bar-fill" style="width: {percent}%"></div>
                </div>
                <span class="loading-percent">{current}/{total}</span>
            </div>
        {/if}
    </div>
</div>

<style>
    .loading-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    }

    .loading-spinner {
        width: calc(40px * var(--ui-scale, 1));
        height: calc(40px * var(--ui-scale, 1));
        border: 3px solid var(--vscode-progressBar-background, #0e639c);
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    .loading-content {
        text-align: center;
    }

    .loading-message {
        margin-top: calc(15px * var(--ui-scale, 1));
        font-size: calc(14px * var(--ui-scale, 1));
        color: var(--vscode-foreground, #cccccc);
    }

    .loading-progress {
        margin-top: calc(10px * var(--ui-scale, 1));
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: calc(8px * var(--ui-scale, 1));
    }

    .loading-bar {
        width: calc(200px * var(--ui-scale, 1));
        height: calc(6px * var(--ui-scale, 1));
        background: var(--vscode-progressBar-background, #0e639c);
        border-radius: calc(3px * var(--ui-scale, 1));
        overflow: hidden;
        opacity: 0.3;
    }

    .loading-bar-fill {
        height: 100%;
        background: var(--vscode-progressBar-background, #0e639c);
        transition: width 0.3s ease;
    }

    .loading-percent {
        font-size: calc(12px * var(--ui-scale, 1));
        color: var(--vscode-descriptionForeground, #888);
    }
</style>
