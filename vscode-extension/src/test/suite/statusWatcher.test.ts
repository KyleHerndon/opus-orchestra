import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

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
    const statusWatcherPath = path.resolve(__dirname, '../../../src/services/StatusWatcher.ts');
    const statusServicePath = path.resolve(__dirname, '../../../src/services/StatusService.ts');
    const hooksTypesPath = path.resolve(__dirname, '../../../src/types/hooks.ts');

    let statusWatcherContent: string;
    let statusServiceContent: string;
    let hooksTypesContent: string;

    setup(() => {
        statusWatcherContent = fs.readFileSync(statusWatcherPath, 'utf-8');
        statusServiceContent = fs.readFileSync(statusServicePath, 'utf-8');
        hooksTypesContent = fs.readFileSync(hooksTypesPath, 'utf-8');
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
    const agentManagerPath = path.resolve(__dirname, '../../../src/agentManager.ts');
    let content: string;

    setup(() => {
        content = fs.readFileSync(agentManagerPath, 'utf-8');
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
        const hooksTypesPath = path.resolve(__dirname, '../../../src/types/hooks.ts');
        const statusServicePath = path.resolve(__dirname, '../../../src/services/StatusService.ts');
        const statusWatcherPath = path.resolve(__dirname, '../../../src/services/StatusWatcher.ts');

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
