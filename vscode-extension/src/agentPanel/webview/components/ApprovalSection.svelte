<script lang="ts">
    import { vscode } from '../main';

    export let agentId: number;
    export let context: string | undefined;

    function handleAllow() {
        vscode.postMessage({
            command: 'sendKey',
            agentId,
            key: '1',
        });
    }

    function handleRespond() {
        vscode.postMessage({
            command: 'focus',
            agentId,
        });
    }
</script>

<div class="approval-section">
    <div class="approval-context">
        {context || 'Permission required'}
    </div>
    <div class="approval-actions">
        <button
            class="btn btn-small btn-primary"
            on:click={handleAllow}
            title="Yes, allow this action"
        >
            Allow
        </button>
        <button
            class="btn btn-small btn-muted"
            on:click={handleRespond}
            title="Go to terminal to reject or provide instructions"
        >
            Respond...
        </button>
    </div>
</div>

<style>
    .approval-section {
        margin-top: calc(12px * var(--ui-scale, 1));
        padding: calc(10px * var(--ui-scale, 1));
        background: var(--vscode-inputValidation-warningBackground, #352a05);
        border: 1px solid var(--vscode-inputValidation-warningBorder, #cca700);
        border-radius: calc(6px * var(--ui-scale, 1));
    }

    .approval-context {
        font-size: calc(12px * var(--ui-scale, 1));
        color: var(--vscode-foreground, #cccccc);
        margin-bottom: calc(8px * var(--ui-scale, 1));
        word-break: break-word;
    }

    .approval-actions {
        display: flex;
        gap: calc(8px * var(--ui-scale, 1));
    }
</style>
