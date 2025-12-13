import * as assert from 'assert';

// Import the panel module to test HTML generation
// We'll test the HTML structure statically

/* eslint-disable @typescript-eslint/no-var-requires */

suite('AgentPanel HTML Test Suite', () => {

    // Test that all button actions in the switch statement have corresponding HTML buttons
    test('Button actions should have matching data-action attributes in HTML', () => {
        // These are the actions handled in the webview script's switch statement
        // Note: renameAgent is now handled via inline input blur, not a button
        // Note: sendKey replaces approve/reject for numbered permission options
        const handledActions = [
            'focus',
            'startClaude',
            'sendKey',
            'deleteAgent',
            'viewDiff',
            'createAgents',
            'addAgent',
            'refresh'
        ];

        // Read the source file to check for matching buttons
        const fs = require('fs');
        const path = require('path');

        // Go up from out/test/suite to src
        const srcPath = path.resolve(__dirname, '../../../src/agentPanel.ts');
        const content = fs.readFileSync(srcPath, 'utf-8');

        for (const action of handledActions) {
            // Check that there's a case for this action
            const casePattern = new RegExp(`case\\s*['"]${action}['"]\\s*:`);
            assert.ok(
                casePattern.test(content),
                `Action '${action}' should have a case in the switch statement`
            );

            // Check that there's a button with this data-action (except createAgents which is in empty state)
            const buttonPattern = new RegExp(`data-action=["']${action}["']`);
            assert.ok(
                buttonPattern.test(content),
                `Action '${action}' should have a button with data-action="${action}"`
            );
        }
    });

    test('All data-action buttons should have handlers', () => {
        const fs = require('fs');
        const path = require('path');

        const srcPath = path.resolve(__dirname, '../../../src/agentPanel.ts');
        const content = fs.readFileSync(srcPath, 'utf-8');

        // Find all data-action values in HTML
        const dataActionPattern = /data-action=["']([^"']+)["']/g;
        const actionsInHtml = new Set<string>();
        let match;
        while ((match = dataActionPattern.exec(content)) !== null) {
            actionsInHtml.add(match[1]);
        }

        // Find all cases in the switch statement
        const casePattern = /case\s*['"]([^'"]+)['"]\s*:/g;
        const handledCases = new Set<string>();
        while ((match = casePattern.exec(content)) !== null) {
            handledCases.add(match[1]);
        }

        // Every action in HTML should have a handler
        for (const action of actionsInHtml) {
            assert.ok(
                handledCases.has(action),
                `Button with data-action="${action}" has no handler in switch statement`
            );
        }
    });

    test('Agent cards should include required buttons', () => {
        const fs = require('fs');
        const path = require('path');

        const srcPath = path.resolve(__dirname, '../../../src/agentPanel.ts');
        // Normalize line endings for cross-platform compatibility
        const content = fs.readFileSync(srcPath, 'utf-8').replace(/\r\n/g, '\n');

        // Find the _getAgentCard method - look for the entire method including its return
        const cardMethodStart = content.indexOf('private _getAgentCard(');
        assert.ok(cardMethodStart !== -1, '_getAgentCard method should exist');

        // Find the method's content (look for the closing of the template literal)
        const methodEnd = content.indexOf("    }\n\n    private _escapeHtml", cardMethodStart);
        const cardHtml = content.substring(cardMethodStart, methodEnd);

        // Required buttons that should be in every agent card
        // Note: rename is now an inline input, not a button
        const requiredButtons = [
            'focus',       // Focus/Open Terminal
            'startClaude', // Start Claude
            'deleteAgent', // Delete
            'viewDiff'     // View diff (icon button)
        ];

        for (const action of requiredButtons) {
            assert.ok(
                cardHtml.includes(`data-action="${action}"`),
                `Agent card should include button with data-action="${action}"`
            );
        }
    });

    test('Buttons with agent-specific actions should have data-agent-id', () => {
        const fs = require('fs');
        const path = require('path');

        const srcPath = path.resolve(__dirname, '../../../src/agentPanel.ts');
        const content = fs.readFileSync(srcPath, 'utf-8');

        // Actions that require an agent ID
        // Note: renameAgent is now handled via inline input, not button
        // Note: sendKey replaces approve/reject
        const agentSpecificActions = [
            'focus',
            'startClaude',
            'sendKey',
            'deleteAgent',
            'viewDiff'
        ];

        for (const action of agentSpecificActions) {
            // Find buttons with this action
            const pattern = new RegExp(`data-action="${action}"[^>]*>`, 'g');
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const buttonTag = match[0];
                assert.ok(
                    buttonTag.includes('data-agent-id'),
                    `Button with data-action="${action}" should have data-agent-id attribute`
                );
            }
        }
    });

    test('Agent cards should have inline rename input', () => {
        const fs = require('fs');
        const path = require('path');

        const srcPath = path.resolve(__dirname, '../../../src/agentPanel.ts');
        // Normalize line endings for cross-platform compatibility
        const content = fs.readFileSync(srcPath, 'utf-8').replace(/\r\n/g, '\n');

        // Find the _getAgentCard method
        const cardMethodStart = content.indexOf('private _getAgentCard(');
        assert.ok(cardMethodStart !== -1, '_getAgentCard method should exist');

        const methodEnd = content.indexOf("    }\n\n    private _escapeHtml", cardMethodStart);
        const cardHtml = content.substring(cardMethodStart, methodEnd);

        // Check for inline rename input with required attributes
        assert.ok(
            cardHtml.includes('class="agent-title-input"'),
            'Agent card should have inline title input'
        );
        assert.ok(
            cardHtml.includes('data-agent-id='),
            'Title input should have data-agent-id'
        );
        assert.ok(
            cardHtml.includes('data-original='),
            'Title input should have data-original for reverting'
        );
    });

    test('Inline rename should have blur and keydown handlers', () => {
        const fs = require('fs');
        const path = require('path');

        const srcPath = path.resolve(__dirname, '../../../src/agentPanel.ts');
        const content = fs.readFileSync(srcPath, 'utf-8');

        // Check for blur handler
        assert.ok(
            content.includes("addEventListener('blur'") && content.includes('agent-title-input'),
            'Should have blur event listener for title input'
        );

        // Check for keydown handler (Enter/Escape)
        assert.ok(
            content.includes("addEventListener('keydown'") && content.includes('agent-title-input'),
            'Should have keydown event listener for title input'
        );

        // Check that it posts renameAgent command
        assert.ok(
            content.includes("command: 'renameAgent'") && content.includes('newName'),
            'Blur handler should post renameAgent command with newName'
        );
    });
});

suite('Message Handler Test Suite', () => {

    test('All webview commands should have extension handlers', () => {
        const fs = require('fs');
        const path = require('path');

        const srcPath = path.resolve(__dirname, '../../../src/agentPanel.ts');
        const content = fs.readFileSync(srcPath, 'utf-8');

        // Commands sent from webview via vscode.postMessage
        const postMessagePattern = /vscode\.postMessage\(\s*\{\s*command:\s*['"]([^'"]+)['"]/g;
        const sentCommands = new Set<string>();
        let match;
        while ((match = postMessagePattern.exec(content)) !== null) {
            sentCommands.add(match[1]);
        }

        // Find the _handleMessage method and extract handled commands
        const handleMessageMatch = content.match(/_handleMessage\([^)]*\)[^{]*\{[\s\S]*?switch\s*\([^)]*\)\s*\{([\s\S]*?)\n\s{8}\}/);
        assert.ok(handleMessageMatch, '_handleMessage method should exist with switch statement');

        const switchContent = handleMessageMatch[1];
        const handlerCasePattern = /case\s*['"]([^'"]+)['"]\s*:/g;
        const handledCommands = new Set<string>();
        while ((match = handlerCasePattern.exec(switchContent)) !== null) {
            handledCommands.add(match[1]);
        }

        // Every command sent should have a handler
        for (const cmd of sentCommands) {
            assert.ok(
                handledCommands.has(cmd),
                `Command '${cmd}' is sent via postMessage but has no handler in _handleMessage`
            );
        }
    });
});
