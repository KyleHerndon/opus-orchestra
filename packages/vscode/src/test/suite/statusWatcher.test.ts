import * as assert from 'assert';
import * as fs from 'fs';

/**
 * Static analysis tests for StatusService and StatusWatcher
 *
 * These tests verify the fix for the bug where approving via UI
 * would have its status overwritten by StatusWatcher reading
 * a stale status file before Claude writes a new one.
 *
 * The fix:
 * 1. StatusService returns file timestamp with parsed status
 * 2. StatusWatcher compares timestamp against agent.lastInteractionTime
 * 3. If file is older than last interaction, skip the status update
 */

suite('StatusWatcher Stale File Detection Test Suite', () => {
    const statusWatcherPath = `${__dirname}/../../../src/services/StatusWatcher.ts`;
    // StatusService implementation is in the core package
    const statusServicePath = `${__dirname}/../../../../core/src/services/StatusService.ts`;
    // ParsedStatus is now in the core package
    const hooksTypesPath = `${__dirname}/../../../../core/src/types/hooks.ts`;

    let statusWatcherContent: string;
    let statusServiceContent: string;
    let hooksTypesContent: string;

    setup(() => {
        statusWatcherContent = fs.readFileSync(statusWatcherPath, 'utf-8').replace(/\r\n/g, '\n');
        statusServiceContent = fs.readFileSync(statusServicePath, 'utf-8').replace(/\r\n/g, '\n');
        hooksTypesContent = fs.readFileSync(hooksTypesPath, 'utf-8').replace(/\r\n/g, '\n');
    });

    test('ParsedStatus interface should include fileTimestamp field', () => {
        assert.ok(
            hooksTypesContent.includes('fileTimestamp'),
            'ParsedStatus should have fileTimestamp field'
        );
        assert.ok(
            hooksTypesContent.includes('fileTimestamp?: number'),
            'fileTimestamp should be optional number type'
        );
    });

    test('StatusService.findLatestFile should return both path and mtime', () => {
        // Check return type includes mtime
        assert.ok(
            statusServiceContent.includes('{ path: string; mtime: number }'),
            'findLatestFile should return object with path and mtime'
        );

        // Check it actually returns the mtime
        assert.ok(
            statusServiceContent.includes('{ path: latestFile, mtime: latestTime }'),
            'findLatestFile should return latestTime as mtime'
        );
    });

    test('StatusService.checkStatus should set fileTimestamp from file mtime', () => {
        // Check that checkStatus uses fileInfo.mtime
        assert.ok(
            statusServiceContent.includes('fileInfo.mtime'),
            'checkStatus should access fileInfo.mtime'
        );

        // Check that it sets parsed.fileTimestamp
        assert.ok(
            statusServiceContent.includes('parsed.fileTimestamp = fileInfo.mtime'),
            'checkStatus should set parsed.fileTimestamp from file mtime'
        );
    });

    test('StatusWatcher.checkAgentStatus should skip stale status files', () => {
        // Check for timestamp comparison
        assert.ok(
            statusWatcherContent.includes('parsedStatus.fileTimestamp'),
            'checkAgentStatus should check parsedStatus.fileTimestamp'
        );

        // Check it compares against lastInteractionTime
        assert.ok(
            statusWatcherContent.includes('agent.lastInteractionTime.getTime()'),
            'checkAgentStatus should compare against agent.lastInteractionTime'
        );

        // Check it skips update when file is older
        assert.ok(
            statusWatcherContent.includes('parsedStatus.fileTimestamp < lastInteractionMs'),
            'checkAgentStatus should skip update when file is older than interaction'
        );

        // Check it has debug logging for skipped updates
        assert.ok(
            statusWatcherContent.includes('Skipping stale status file'),
            'checkAgentStatus should log when skipping stale files'
        );
    });

    test('StatusWatcher should return false when skipping stale files', () => {
        // Find the stale file check block
        const staleCheckPattern = /if\s*\(parsedStatus\.fileTimestamp\s*<\s*lastInteractionMs\)/;
        assert.ok(
            staleCheckPattern.test(statusWatcherContent),
            'Should have stale timestamp comparison'
        );

        // The block should return false to skip the update
        assert.ok(
            statusWatcherContent.includes('Skipping stale status file') &&
            statusWatcherContent.includes('return false'),
            'Should return false after logging stale file skip'
        );
    });
});

suite('AgentManager sendToAgent Test Suite', () => {
    const agentManagerPath = `${__dirname}/../../../src/agentManager.ts`;
    let content: string;

    setup(() => {
        content = fs.readFileSync(agentManagerPath, 'utf-8').replace(/\r\n/g, '\n');
    });

    test('sendToAgent should update lastInteractionTime before emitting event', () => {
        // Find sendToAgent method
        const methodStart = content.indexOf('sendToAgent(agentId: number, text: string)');
        const methodEnd = content.indexOf('\n    }', methodStart + 50);
        const methodContent = content.substring(methodStart, methodEnd);

        // Verify it sets status to working
        assert.ok(
            methodContent.includes("agent.status = 'working'"),
            'sendToAgent should set status to working'
        );

        // Verify it clears pendingApproval
        assert.ok(
            methodContent.includes('agent.pendingApproval = null'),
            'sendToAgent should clear pendingApproval'
        );

        // Verify it updates lastInteractionTime
        assert.ok(
            methodContent.includes('agent.lastInteractionTime = new Date()'),
            'sendToAgent should update lastInteractionTime'
        );

        // Verify it emits approval:resolved
        assert.ok(
            methodContent.includes("'approval:resolved'"),
            'sendToAgent should emit approval:resolved event'
        );
    });

    test('lastInteractionTime should be updated before checking hadPendingApproval', () => {
        // This ensures the timestamp is set before the event is emitted,
        // so StatusWatcher will see the updated time when it next polls
        const methodStart = content.indexOf('sendToAgent(agentId: number, text: string)');
        const methodEnd = content.indexOf('\n    }', methodStart + 50);
        const methodContent = content.substring(methodStart, methodEnd);

        const timeUpdateIndex = methodContent.indexOf('lastInteractionTime = new Date()');
        const emitIndex = methodContent.indexOf("'approval:resolved'");

        assert.ok(timeUpdateIndex !== -1, 'Should find lastInteractionTime update');
        assert.ok(emitIndex !== -1, 'Should find approval:resolved emit');
        assert.ok(
            timeUpdateIndex < emitIndex,
            'lastInteractionTime should be updated before emitting approval:resolved'
        );
    });
});

suite('Approval Flow Integration Test Suite', () => {
    /**
     * Tests verifying the complete approval flow components work together
     */

    test('All approval flow components are in sync', () => {
        // ParsedStatus is now in the core package
        const hooksTypesPath = `${__dirname}/../../../../core/src/types/hooks.ts`;
        // StatusService implementation is in the core package
        const statusServicePath = `${__dirname}/../../../../core/src/services/StatusService.ts`;
        const statusWatcherPath = `${__dirname}/../../../src/services/StatusWatcher.ts`;

        const hooksTypes = fs.readFileSync(hooksTypesPath, 'utf-8');
        const statusService = fs.readFileSync(statusServicePath, 'utf-8');
        const statusWatcher = fs.readFileSync(statusWatcherPath, 'utf-8');

        // 1. ParsedStatus has fileTimestamp
        assert.ok(
            hooksTypes.includes('fileTimestamp'),
            'Step 1: ParsedStatus interface should have fileTimestamp'
        );

        // 2. StatusService sets fileTimestamp
        assert.ok(
            statusService.includes('parsed.fileTimestamp'),
            'Step 2: StatusService should set parsed.fileTimestamp'
        );

        // 3. StatusWatcher checks fileTimestamp
        assert.ok(
            statusWatcher.includes('parsedStatus.fileTimestamp'),
            'Step 3: StatusWatcher should check parsedStatus.fileTimestamp'
        );

        // 4. StatusWatcher compares against lastInteractionTime
        assert.ok(
            statusWatcher.includes('lastInteractionTime'),
            'Step 4: StatusWatcher should compare against lastInteractionTime'
        );
    });
});

suite('AgentManager getAgents Terminal Validation Test Suite', () => {
    /**
     * Tests verifying that getAgents() validates terminal state
     * to fix the bug where button shows wrong state after VS Code reload
     */

    const agentManagerPath = `${__dirname}/../../../src/agentManager.ts`;
    let content: string;

    setup(() => {
        content = fs.readFileSync(agentManagerPath, 'utf-8').replace(/\r\n/g, '\n');
    });

    test('getAgents should validate terminal state before returning', () => {
        // Find the getAgents method
        const methodMatch = content.match(/getAgents\(\): Agent\[\] \{[\s\S]*?return Array\.from/);
        assert.ok(methodMatch, 'getAgents method should exist');

        const methodContent = methodMatch[0];

        // Should check if terminal is alive via adapter
        assert.ok(
            methodContent.includes('this.terminalAdapter.isAlive'),
            'getAgents should check if terminal is alive via adapter'
        );

        // Should clear stale terminal references
        assert.ok(
            methodContent.includes('agent.terminal = null'),
            'getAgents should clear stale terminal references'
        );
    });

    test('getAgents should use terminalAdapter for validation', () => {
        const methodMatch = content.match(/getAgents\(\): Agent\[\] \{[\s\S]*?return Array\.from/);
        assert.ok(methodMatch, 'getAgents method should exist');

        const methodContent = methodMatch[0];

        assert.ok(
            methodContent.includes('this.terminalAdapter.isAlive'),
            'getAgents should use terminalAdapter for terminal validation'
        );
    });
});

suite('AgentManager showAgentDiff Test Suite', () => {
    /**
     * Tests verifying the multi-file diff view feature
     */

    const agentManagerPath = `${__dirname}/../../../src/agentManager.ts`;
    let content: string;

    setup(() => {
        content = fs.readFileSync(agentManagerPath, 'utf-8').replace(/\r\n/g, '\n');
    });

    test('showAgentDiff should use git diff --name-status to get file statuses', () => {
        assert.ok(
            content.includes('git diff --name-status'),
            'showAgentDiff should use --name-status to get file change types'
        );
    });

    test('showAgentDiff should get base commit SHA using merge-base', () => {
        assert.ok(
            content.includes('git merge-base'),
            'showAgentDiff should use merge-base to find common ancestor'
        );
    });

    test('showAgentDiff should build resource list with original and modified URIs', () => {
        // Check for the resources array type
        assert.ok(
            content.includes('Array<{ original: vscode.Uri; modified: vscode.Uri }>'),
            'showAgentDiff should define resources array with original/modified URI pairs'
        );

        // Check for git URI construction
        assert.ok(
            content.includes("scheme: 'git'"),
            'showAgentDiff should create git:// URIs for original files'
        );
    });

    test('showAgentDiff should use multi-diff editor for multi-file diff', () => {
        assert.ok(
            content.includes("'_workbench.openMultiDiffEditor'"),
            'showAgentDiff should use _workbench.openMultiDiffEditor command'
        );
    });

    test('showAgentDiff should handle deleted files (D status)', () => {
        assert.ok(
            content.includes("status === 'D'"),
            'showAgentDiff should check for deleted files'
        );
        // Deleted files should be skipped since they have no modified version
        const methodStart = content.indexOf('async showAgentDiff');
        const methodEnd = content.indexOf('\n    isGitRepo()', methodStart);
        const methodContent = content.substring(methodStart, methodEnd);

        assert.ok(
            methodContent.includes("if (status === 'D')") && methodContent.includes('continue'),
            'showAgentDiff should skip deleted files'
        );
    });

    test('showAgentDiff should handle added files (A status)', () => {
        assert.ok(
            content.includes("status === 'A'"),
            'showAgentDiff should check for added files'
        );
        // Added files should use untitled scheme for original (no base version)
        assert.ok(
            content.includes("scheme: 'untitled'"),
            'showAgentDiff should use untitled scheme for added files original'
        );
    });

    test('showAgentDiff should have fallback to QuickPick if multi-diff editor fails', () => {
        const methodStart = content.indexOf('async showAgentDiff');
        const methodEnd = content.indexOf('\n    isGitRepo()', methodStart);
        const methodContent = content.substring(methodStart, methodEnd);

        // Should have try/catch around _workbench.openMultiDiffEditor
        assert.ok(
            methodContent.includes("'_workbench.openMultiDiffEditor'"),
            'showAgentDiff should call _workbench.openMultiDiffEditor command'
        );

        // Should have fallback QuickPick
        assert.ok(
            methodContent.includes('showQuickPick'),
            'showAgentDiff should have QuickPick fallback'
        );

        // Fallback should use git.openChange
        assert.ok(
            methodContent.includes("'git.openChange'"),
            'showAgentDiff fallback should use git.openChange'
        );
    });

    test('showAgentDiff should include file count in title', () => {
        assert.ok(
            content.includes('${resources.length} files'),
            'showAgentDiff should show file count in multi-diff title'
        );
    });
});
