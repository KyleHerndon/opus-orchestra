import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Static analysis tests for AgentPanel
 *
 * These tests verify that HTML buttons and their handlers are in sync.
 * Note: These test implementation details and may break on refactoring.
 * Consider replacing with E2E tests that test actual behavior.
 */

suite('AgentPanel HTML Test Suite', () => {
    // Load source file once for all tests
    const srcPath = path.resolve(__dirname, '../../../src/agentPanel.ts');
    const content = fs.readFileSync(srcPath, 'utf-8').replace(/\r\n/g, '\n');

    // Pre-extract commonly used patterns
    const dataActionPattern = /data-action=["']([^"']+)["']/g;
    const actionsInHtml = new Set<string>();
    let match;
    while ((match = dataActionPattern.exec(content)) !== null) {
        actionsInHtml.add(match[1]);
    }

    const casePattern = /case\s*['"]([^'"]+)['"]\s*:/g;
    const handledCases = new Set<string>();
    while ((match = casePattern.exec(content)) !== null) {
        handledCases.add(match[1]);
    }

    // Extract _getAgentCard method content
    const cardMethodStart = content.indexOf('private _getAgentCard(');
    const methodEnd = content.indexOf("    }\n\n    private _escapeHtml", cardMethodStart);
    const cardHtml = cardMethodStart !== -1 ? content.substring(cardMethodStart, methodEnd) : '';

    test('Button actions should have matching data-action attributes in HTML', () => {
        const handledActions = [
            'focus', 'startClaude', 'sendKey', 'deleteAgent',
            'viewDiff', 'createAgents', 'addAgent', 'refresh'
        ];

        for (const action of handledActions) {
            assert.ok(handledCases.has(action), `Action '${action}' should have a case in switch`);
            assert.ok(actionsInHtml.has(action), `Action '${action}' should have a button`);
        }
    });

    test('All data-action buttons should have handlers', () => {
        for (const action of actionsInHtml) {
            assert.ok(handledCases.has(action), `Button "${action}" has no handler`);
        }
    });

    test('Agent cards should include required buttons', () => {
        assert.ok(cardMethodStart !== -1, '_getAgentCard method should exist');

        const requiredButtons = ['focus', 'startClaude', 'deleteAgent', 'viewDiff'];
        for (const action of requiredButtons) {
            assert.ok(cardHtml.includes(`data-action="${action}"`), `Missing button: ${action}`);
        }
    });

    test('Agent-specific buttons should have data-agent-id', () => {
        const agentSpecificActions = ['focus', 'startClaude', 'sendKey', 'deleteAgent', 'viewDiff'];

        for (const action of agentSpecificActions) {
            const pattern = new RegExp(`data-action="${action}"[^>]*>`, 'g');
            let buttonMatch;
            while ((buttonMatch = pattern.exec(content)) !== null) {
                assert.ok(
                    buttonMatch[0].includes('data-agent-id'),
                    `Button "${action}" should have data-agent-id`
                );
            }
        }
    });

    test('Agent cards should have inline rename input', () => {
        assert.ok(cardHtml.includes('class="agent-title-input"'), 'Missing title input');
        assert.ok(cardHtml.includes('data-agent-id='), 'Title input missing data-agent-id');
        assert.ok(cardHtml.includes('data-original='), 'Title input missing data-original');
    });

    test('Inline rename should have blur and keydown handlers', () => {
        assert.ok(
            content.includes("addEventListener('blur'") && content.includes('agent-title-input'),
            'Missing blur handler for title input'
        );
        assert.ok(
            content.includes("addEventListener('keydown'") && content.includes('agent-title-input'),
            'Missing keydown handler for title input'
        );
        assert.ok(
            content.includes("command: 'renameAgent'") && content.includes('newName'),
            'Blur handler should post renameAgent command'
        );
    });
});

suite('Message Handler Test Suite', () => {
    const srcPath = path.resolve(__dirname, '../../../src/agentPanel.ts');
    const content = fs.readFileSync(srcPath, 'utf-8');

    test('All webview commands should have extension handlers', () => {
        // Extract commands sent via postMessage
        const postMessagePattern = /vscode\.postMessage\(\s*\{\s*command:\s*['"]([^'"]+)['"]/g;
        const sentCommands = new Set<string>();
        let match;
        while ((match = postMessagePattern.exec(content)) !== null) {
            sentCommands.add(match[1]);
        }

        // Extract handled commands from _handleMessage
        const handleMessageMatch = content.match(
            /_handleMessage\([^)]*\)[^{]*\{[\s\S]*?switch\s*\([^)]*\)\s*\{([\s\S]*?)\n\s{8}\}/
        );
        assert.ok(handleMessageMatch, '_handleMessage method should exist');

        const handlerCasePattern = /case\s*['"]([^'"]+)['"]\s*:/g;
        const handledCommands = new Set<string>();
        while ((match = handlerCasePattern.exec(handleMessageMatch![1])) !== null) {
            handledCommands.add(match[1]);
        }

        // Verify all sent commands have handlers
        for (const cmd of sentCommands) {
            assert.ok(handledCommands.has(cmd), `Command '${cmd}' has no handler`);
        }
    });
});
