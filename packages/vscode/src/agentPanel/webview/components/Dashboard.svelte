<script lang="ts">
    import { stats, agentsByRepo, repoPaths } from '../stores';
    import RepoSection from './RepoSection.svelte';

    // Get all repo paths that should be displayed
    $: allRepoPaths = Array.from(new Set([...$repoPaths, ...$agentsByRepo.keys()]));
</script>

<div class="stats-bar">
    <div class="stats-title">Opus Orchestra Dashboard</div>
    <div class="stat">
        <div class="stat-value">{$stats.total}</div>
        <div class="stat-label">Total Agents</div>
    </div>
    <div class="stat">
        <div class="stat-value">{$stats.working}</div>
        <div class="stat-label">Working</div>
    </div>
    <div class="stat">
        <div class="stat-value">{$stats.waiting}</div>
        <div class="stat-label">Waiting</div>
    </div>
    <div class="stat">
        <div class="stat-value">{$stats.containerized}</div>
        <div class="stat-label">Containerized</div>
    </div>
    <div class="stat">
        <div class="diff-stats">
            <span class="diff-add">+{$stats.insertions}</span>
            <span class="diff-del">-{$stats.deletions}</span>
        </div>
        <div class="stat-label">Changes</div>
    </div>
</div>

{#each allRepoPaths as repoPath, index}
    <RepoSection
        {repoPath}
        repoIndex={index}
        agents={$agentsByRepo.get(repoPath) || []}
    />
{/each}

<style>
    .stats-bar {
        display: flex;
        gap: calc(20px * var(--ui-scale, 1));
        margin-bottom: calc(20px * var(--ui-scale, 1));
        padding: calc(15px * var(--ui-scale, 1));
        background: var(--vscode-sideBar-background, #252526);
        border-radius: calc(8px * var(--ui-scale, 1));
        align-items: center;
    }

    .stats-title {
        font-size: calc(16px * var(--ui-scale, 1));
        font-weight: 600;
        color: var(--vscode-foreground, #cccccc);
        margin-right: auto;
    }

    .stat {
        text-align: center;
        padding: calc(5px * var(--ui-scale, 1)) calc(10px * var(--ui-scale, 1));
    }

    .stat-value {
        font-size: calc(20px * var(--ui-scale, 1));
        font-weight: bold;
        color: var(--vscode-textLink-foreground, #3794ff);
    }

    .stat-label {
        font-size: calc(11px * var(--ui-scale, 1));
        color: var(--vscode-descriptionForeground, #888);
        text-transform: uppercase;
    }
</style>
