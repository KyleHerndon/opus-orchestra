import * as assert from 'assert';
import * as fs from 'fs';

/**
 * Tests for Terminal Auto-Start Feature and Tmux Integration
 *
 * These tests verify that the terminal auto-start/resume functionality
 * and tmux session management are correctly implemented in the codebase.
 */

suite('Terminal Auto-Start Feature Test Suite', () => {
    // Load source files
    const agentManagerPath = `${__dirname}/../../../src/agentManager.ts`;
    // ExtensionConfig is now in the core package
    const configPath = `${__dirname}/../../../../core/src/adapters/ConfigAdapter.ts`;
    // Events are now defined in core, vscode re-exports from there
    const eventsPath = `${__dirname}/../../../../core/src/types/events.ts`;
    const configServicePath = `${__dirname}/../../../src/services/ConfigService.ts`;
    // TmuxService implementation is now in core, vscode re-exports from there
    const tmuxServicePath = `${__dirname}/../../../../core/src/services/TmuxService.ts`;
    const tmuxServiceWrapperPath = `${__dirname}/../../../src/services/TmuxService.ts`;
    const packageJsonPath = `${__dirname}/../../../package.json`;

    const agentManagerContent = fs.readFileSync(agentManagerPath, 'utf-8');
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const eventsContent = fs.readFileSync(eventsPath, 'utf-8');
    const configServiceContent = fs.readFileSync(configServicePath, 'utf-8');
    // Core TmuxService has the implementation
    const tmuxServiceContent = fs.readFileSync(tmuxServicePath, 'utf-8');
    // VS Code wrapper re-exports from core
    const tmuxServiceWrapperContent = fs.readFileSync(tmuxServiceWrapperPath, 'utf-8');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    suite('Configuration', () => {
        test('autoStartClaudeOnFocus should be defined in ExtensionConfig interface', () => {
            assert.ok(
                configContent.includes('autoStartClaudeOnFocus: boolean'),
                'autoStartClaudeOnFocus should be in ExtensionConfig'
            );
        });

        test('autoStartClaudeOnFocus should have a default value in DEFAULT_CONFIG', () => {
            assert.ok(
                configContent.includes('autoStartClaudeOnFocus:') &&
                configContent.includes('DEFAULT_CONFIG'),
                'DEFAULT_CONFIG should have autoStartClaudeOnFocus'
            );
        });

        test('ConfigService should have autoStartClaudeOnFocus getter', () => {
            assert.ok(
                configServiceContent.includes('get autoStartClaudeOnFocus()'),
                'ConfigService should have autoStartClaudeOnFocus getter'
            );
        });

        test('package.json should include autoStartClaudeOnFocus setting', () => {
            const properties = packageJson.contributes?.configuration?.properties;
            assert.ok(properties, 'package.json should have configuration properties');
            assert.ok(
                properties['claudeAgents.autoStartClaudeOnFocus'],
                'package.json should have autoStartClaudeOnFocus setting'
            );
            assert.strictEqual(
                properties['claudeAgents.autoStartClaudeOnFocus'].type,
                'boolean',
                'autoStartClaudeOnFocus should be a boolean'
            );
            assert.strictEqual(
                properties['claudeAgents.autoStartClaudeOnFocus'].default,
                true,
                'autoStartClaudeOnFocus should default to true'
            );
        });
    });

    suite('Events', () => {
        test('agent:terminalCreated event should be defined in EventType', () => {
            assert.ok(
                eventsContent.includes("'agent:terminalCreated'"),
                'agent:terminalCreated should be in EventType'
            );
        });

        test('agent:terminalCreated should have payload type defined', () => {
            // isNew can be optional (isNew?) or required (isNew:)
            assert.ok(
                eventsContent.includes("'agent:terminalCreated': { agent: Agent; isNew"),
                'agent:terminalCreated should have proper payload type'
            );
        });
    });

    suite('AgentManager', () => {
        test('focusAgent should be async', () => {
            assert.ok(
                agentManagerContent.includes('async focusAgent(agentId: number): Promise<void>'),
                'focusAgent should be an async method'
            );
        });

        test('focusAgent should emit agent:terminalCreated event', () => {
            assert.ok(
                agentManagerContent.includes("getEventBus().emit('agent:terminalCreated'"),
                'focusAgent should emit agent:terminalCreated event'
            );
        });

        test('focusAgent should set up oo alias for Claude', () => {
            assert.ok(
                agentManagerContent.includes("alias oo="),
                'focusAgent should set up oo alias'
            );
        });

        test('focusAgent should include session ID in oo alias', () => {
            assert.ok(
                agentManagerContent.includes('--session-id'),
                'oo alias should include --session-id'
            );
        });

        test('focusAgent should check if terminal is alive before creating', () => {
            assert.ok(
                agentManagerContent.includes('this.terminalAdapter.isAlive(agent.terminal)'),
                'focusAgent should check terminal liveness via adapter'
            );
        });
    });

    suite('Integration', () => {
        test('focusAgent should handle both tmux and non-tmux modes', () => {
            const focusAgentMethod = agentManagerContent.match(
                /async focusAgent\(agentId: number\): Promise<void> \{[\s\S]*?\n {4}\}/
            );
            assert.ok(focusAgentMethod, 'focusAgent method should exist');
            assert.ok(
                focusAgentMethod[0].includes('if (config.useTmux'),
                'focusAgent should check useTmux config'
            );
            assert.ok(
                focusAgentMethod[0].includes('ooAlias'),
                'focusAgent should set up oo alias'
            );
        });

        test('focusAgent should check for existing terminal before creating new one', () => {
            const focusAgentMethod = agentManagerContent.match(
                /async focusAgent\(agentId: number\): Promise<void> \{[\s\S]*?\n {4}\}/
            );
            assert.ok(focusAgentMethod, 'focusAgent method should exist');
            assert.ok(
                focusAgentMethod[0].includes('this.terminalAdapter.isAlive'),
                'focusAgent should check if terminal is alive via adapter'
            );
            assert.ok(
                focusAgentMethod[0].includes('this.terminalAdapter.findByName'),
                'focusAgent should try to find terminal by name via adapter'
            );
        });

        test('focusAgent should create terminal with tmux as shell in tmux mode', () => {
            const focusAgentMethod = agentManagerContent.match(
                /async focusAgent\(agentId: number\): Promise<void> \{[\s\S]*?\n {4}\}/
            );
            assert.ok(focusAgentMethod, 'focusAgent method should exist');
            assert.ok(
                focusAgentMethod[0].includes("shellPath: 'tmux'"),
                'focusAgent should create terminal with tmux as shell'
            );
        });
    });

    suite('Tmux Configuration', () => {
        test('useTmux should be defined in ExtensionConfig interface', () => {
            assert.ok(
                configContent.includes('useTmux: boolean'),
                'useTmux should be in ExtensionConfig'
            );
        });

        test('tmuxSessionPrefix should be defined in ExtensionConfig interface', () => {
            assert.ok(
                configContent.includes('tmuxSessionPrefix: string'),
                'tmuxSessionPrefix should be in ExtensionConfig'
            );
        });

        test('useTmux should default to true in DEFAULT_CONFIG', () => {
            assert.ok(
                configContent.includes('useTmux: true'),
                'useTmux should default to true'
            );
        });

        test('tmuxSessionPrefix should default to opus in DEFAULT_CONFIG', () => {
            assert.ok(
                configContent.includes("tmuxSessionPrefix: 'opus'"),
                'tmuxSessionPrefix should default to opus'
            );
        });

        test('ConfigService should have useTmux getter', () => {
            assert.ok(
                configServiceContent.includes('get useTmux()'),
                'ConfigService should have useTmux getter'
            );
        });

        test('ConfigService should have tmuxSessionPrefix getter', () => {
            assert.ok(
                configServiceContent.includes('get tmuxSessionPrefix()'),
                'ConfigService should have tmuxSessionPrefix getter'
            );
        });

        test('package.json should include tmux settings', () => {
            const properties = packageJson.contributes?.configuration?.properties;
            assert.ok(properties, 'package.json should have configuration properties');
            assert.ok(
                properties['claudeAgents.useTmux'],
                'package.json should have useTmux setting'
            );
            assert.ok(
                properties['claudeAgents.tmuxSessionPrefix'],
                'package.json should have tmuxSessionPrefix setting'
            );
        });
    });

    suite('TmuxService', () => {
        test('Core TmuxService should exist', () => {
            assert.ok(
                tmuxServiceContent.includes('export class TmuxService'),
                'TmuxService class should exist in core'
            );
        });

        test('VS Code wrapper should re-export from core', () => {
            assert.ok(
                tmuxServiceWrapperContent.includes("from '@opus-orchestra/core'"),
                'VS Code TmuxService should re-export from core'
            );
            assert.ok(
                tmuxServiceWrapperContent.includes('getTmuxService'),
                'VS Code should export getTmuxService function'
            );
        });

        test('TmuxService should have getSessionName method', () => {
            assert.ok(
                tmuxServiceContent.includes('getSessionName(sessionId: string)'),
                'TmuxService should have getSessionName method'
            );
        });

        test('getSessionName should use sessionId for stability across renames', () => {
            assert.ok(
                tmuxServiceContent.includes('substring(0, 12)'),
                'getSessionName should use sessionId substring'
            );
        });

        test('TmuxService should have sessionExists method', () => {
            assert.ok(
                tmuxServiceContent.includes('sessionExists(sessionName: string)'),
                'TmuxService should have sessionExists method'
            );
        });

        test('TmuxService should have containerSessionExists method', () => {
            assert.ok(
                tmuxServiceContent.includes('containerSessionExists(containerId: string'),
                'TmuxService should have containerSessionExists for container support'
            );
        });

        test('TmuxService should have listSessions method', () => {
            assert.ok(
                tmuxServiceContent.includes('listSessions(): string[]'),
                'TmuxService should have listSessions method'
            );
        });

        test('TmuxService should use SystemAdapter for execution', () => {
            assert.ok(
                tmuxServiceContent.includes('this.system.execSync') ||
                tmuxServiceContent.includes('this.system.exec'),
                'TmuxService should use SystemAdapter for command execution'
            );
        });

        test('TmuxService should have killSession method', () => {
            assert.ok(
                tmuxServiceContent.includes('killSession(sessionName: string)'),
                'TmuxService should have killSession for cleanup'
            );
        });

        test('TmuxService should have killContainerSession method', () => {
            assert.ok(
                tmuxServiceContent.includes('killContainerSession(containerId: string'),
                'TmuxService should have killContainerSession for container cleanup'
            );
        });
    });

    suite('AgentManager Tmux Integration', () => {
        test('AgentManager should import getTmuxService', () => {
            assert.ok(
                agentManagerContent.includes('getTmuxService'),
                'AgentManager should import getTmuxService'
            );
        });

        test('focusAgent should use TmuxService when tmux is enabled', () => {
            assert.ok(
                agentManagerContent.includes('tmuxService.sessionExists') ||
                agentManagerContent.includes('tmuxService.getSessionName'),
                'focusAgent should use TmuxService for session management'
            );
        });

        test('deleteAgent should clean up tmux sessions', () => {
            assert.ok(
                agentManagerContent.includes('tmuxService.killSession') ||
                agentManagerContent.includes('tmuxService.getSessionName'),
                'deleteAgent should clean up tmux sessions'
            );
        });

        test('cleanup should clean up all tmux sessions', () => {
            // Find the cleanup method and verify it handles tmux
            const cleanupMethod = agentManagerContent.match(
                /async cleanup\(\): Promise<void> \{[\s\S]*?\n {4}\}/
            );
            assert.ok(cleanupMethod, 'cleanup method should exist');
            assert.ok(
                cleanupMethod[0].includes('tmuxService') || cleanupMethod[0].includes('getTmuxService'),
                'cleanup should handle tmux sessions'
            );
        });
    });

    // Note: AgentPanel has been refactored to use Svelte components.
    // The event-driven UI is now handled by Svelte's reactive stores.
    // See src/agentPanel/webview/ for the Svelte implementation.
});
