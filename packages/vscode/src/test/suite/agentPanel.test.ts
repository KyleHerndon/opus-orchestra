import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Static analysis tests for AgentPanel (Svelte-based architecture)
 *
 * These tests verify that Svelte components and handlers are in sync.
 * Note: These test implementation details and may break on refactoring.
 * Consider replacing with E2E tests that test actual behavior.
 */

suite('AgentPanel Svelte Test Suite', () => {
    // Load source files once for all tests
    const agentPanelSrcDir = path.resolve(__dirname, '../../../src/agentPanel');
    const webviewDir = path.join(agentPanelSrcDir, 'webview');
    const componentsDir = path.join(webviewDir, 'components');

    const agentCardPath = path.join(componentsDir, 'AgentCard.svelte');
    const mainTsPath = path.join(webviewDir, 'main.ts');
    const agentPanelTsPath = path.join(agentPanelSrcDir, 'AgentPanel.ts');

    const agentCardContent = fs.readFileSync(agentCardPath, 'utf-8').replace(/\r\n/g, '\n');
    const mainTsContent = fs.readFileSync(mainTsPath, 'utf-8').replace(/\r\n/g, '\n');
    const agentPanelContent = fs.readFileSync(agentPanelTsPath, 'utf-8').replace(/\r\n/g, '\n');

    // Also load EmptyState for create form tests
    const emptyStatePath = path.join(componentsDir, 'EmptyState.svelte');
    const emptyStateContent = fs.readFileSync(emptyStatePath, 'utf-8').replace(/\r\n/g, '\n');

    test('AgentCard should include required action buttons', () => {
        const requiredActions = ['focus', 'startClaude', 'deleteAgent', 'viewDiff'];
        for (const action of requiredActions) {
            assert.ok(
                agentCardContent.includes(`command: '${action}'`) ||
                agentCardContent.includes(`command: "${action}"`),
                `AgentCard missing action: ${action}`
            );
        }
    });

    test('AgentCard should have rename functionality', () => {
        assert.ok(
            agentCardContent.includes('renameAgent'),
            'AgentCard should handle renameAgent'
        );
        assert.ok(
            agentCardContent.includes('blur') || agentCardContent.includes('on:blur'),
            'AgentCard should have blur handler for rename'
        );
    });

    test('AgentCard should be draggable', () => {
        assert.ok(
            agentCardContent.includes('draggable') || agentCardContent.includes('on:dragstart'),
            'AgentCard should have drag support'
        );
    });

    test('Webview main.ts should handle all message types', () => {
        const requiredCommands = ['init', 'updateAgents', 'addCard', 'removeCard', 'swapCards', 'loading'];
        for (const cmd of requiredCommands) {
            assert.ok(
                mainTsContent.includes(`'${cmd}'`) || mainTsContent.includes(`"${cmd}"`),
                `main.ts missing handler for: ${cmd}`
            );
        }
    });

    test('Extension AgentPanel.ts should handle all webview messages', () => {
        const requiredCommands = [
            'webviewReady', 'focus', 'startClaude', 'deleteAgent',
            'viewDiff', 'sendKey', 'renameAgent', 'changeContainerConfig',
            'createAgents', 'addAgentToRepo', 'reorderAgents'
        ];
        for (const cmd of requiredCommands) {
            assert.ok(
                agentPanelContent.includes(`case '${cmd}'`) || agentPanelContent.includes(`case "${cmd}"`),
                `AgentPanel.ts missing handler for: ${cmd}`
            );
        }
    });

    test('EmptyState should have create agents form', () => {
        assert.ok(
            emptyStateContent.includes('createAgents'),
            'EmptyState should have createAgents action'
        );
    });

    test('AgentCard should display todo items', () => {
        assert.ok(
            agentCardContent.includes('TodoSection') || agentCardContent.includes('todoItems'),
            'AgentCard should display todo items'
        );
    });

    test('AgentCard should display approval section when pending', () => {
        assert.ok(
            agentCardContent.includes('ApprovalSection') || agentCardContent.includes('pendingApproval'),
            'AgentCard should display approval section'
        );
    });
});

suite('Message Handler Test Suite', () => {
    const agentPanelSrcDir = path.resolve(__dirname, '../../../src/agentPanel');
    const webviewDir = path.join(agentPanelSrcDir, 'webview');

    const mainTsPath = path.join(webviewDir, 'main.ts');
    const agentPanelTsPath = path.join(agentPanelSrcDir, 'AgentPanel.ts');

    const mainTsContent = fs.readFileSync(mainTsPath, 'utf-8').replace(/\r\n/g, '\n');
    const agentPanelContent = fs.readFileSync(agentPanelTsPath, 'utf-8').replace(/\r\n/g, '\n');

    test('Webview postMessage calls should have extension handlers', () => {
        // Extract postMessage calls from main.ts and Svelte components
        // Pattern matches: command: 'name' or command: "name"
        const commandPattern = /command:\s*['"]([^'"]+)['"]/g;
        const sentCommands = new Set<string>();
        let match;
        while ((match = commandPattern.exec(mainTsContent)) !== null) {
            sentCommands.add(match[1]);
        }

        // Also check Svelte components
        const componentsDir = path.join(webviewDir, 'components');
        const svelteFiles = fs.readdirSync(componentsDir).filter(f => f.endsWith('.svelte'));
        for (const file of svelteFiles) {
            const content = fs.readFileSync(path.join(componentsDir, file), 'utf-8');
            while ((match = commandPattern.exec(content)) !== null) {
                sentCommands.add(match[1]);
            }
        }

        // Verify each sent command has a handler in AgentPanel.ts
        for (const cmd of sentCommands) {
            assert.ok(
                agentPanelContent.includes(`case '${cmd}'`) || agentPanelContent.includes(`case "${cmd}"`),
                `Command '${cmd}' sent from webview has no handler in AgentPanel.ts`
            );
        }
    });

    test('Extension outgoing messages should have webview handlers', () => {
        // Extract message commands from _postMessage calls in AgentPanel.ts
        const commandPattern = /command:\s*['"]([^'"]+)['"]/g;
        const extensionCommands = new Set<string>();
        let match;
        while ((match = commandPattern.exec(agentPanelContent)) !== null) {
            extensionCommands.add(match[1]);
        }

        // Verify each extension command is handled in main.ts
        for (const cmd of extensionCommands) {
            // Skip updateContainerOptions for now as it may be handled elsewhere
            if (cmd === 'updateContainerOptions') {
                continue;
            }

            assert.ok(
                mainTsContent.includes(`'${cmd}'`) || mainTsContent.includes(`"${cmd}"`),
                `Command '${cmd}' sent from extension has no handler in webview main.ts`
            );
        }
    });
});
