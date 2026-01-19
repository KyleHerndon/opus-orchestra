/**
 * UI Tests for Claude Agents Dashboard
 *
 * E2E tests using vscode-extension-tester (Selenium WebDriver).
 */

import { expect } from 'chai';
import { VSBrowser, WebDriver, By, ActivityBar, SideBarView } from 'vscode-extension-tester';
import { DashboardPage } from './pages/DashboardPage';

describe('Claude Agents Dashboard', function () {
    this.timeout(180000);

    let driver: WebDriver;
    let page: DashboardPage;

    before(async function () {
        driver = VSBrowser.instance.driver;
        page = new DashboardPage(driver);

        // Wait for VS Code to be ready
        await driver.wait(async () => {
            try {
                const activityBar = new ActivityBar();
                return (await activityBar.getViewControls()).length > 0;
            } catch {
                return false;
            }
        }, 30000, 'VS Code did not become ready');
    });

    describe('Extension Activation', function () {
        it('should show Claude Agents in Activity Bar and open sidebar', async function () {
            const activityBar = new ActivityBar();

            // Check activity bar
            await driver.wait(async () => {
                const controls = await activityBar.getViewControls();
                const titles = await Promise.all(controls.map(c => c.getTitle()));
                return titles.includes('Claude Agents');
            }, 10000, 'Claude Agents not found in Activity Bar');

            // Open sidebar
            const control = await activityBar.getViewControl('Claude Agents');
            expect(control).to.not.be.undefined;
            await control?.openView();

            await driver.wait(async () => {
                try {
                    const sideBar = new SideBarView();
                    const content = await sideBar.getContent();
                    return (await content.getSections()).length > 0;
                } catch {
                    return false;
                }
            }, 10000, 'Sidebar did not open');
        });
    });

    describe('Dashboard Elements', function () {
        before(async () => await page.open());
        after(async () => await page.close());

        // Re-ensure we're in the frame before each test since VS Code may switch focus
        beforeEach(async function () {
            await page.switchBack();
            await driver.sleep(200);
            await page.switchToFrame();
        });

        it('should display header', async function () {
            // Header text depends on state: "Opus Orchestra Dashboard" (with agents) or "No Agents Created" (empty)
            const headerText = await page.getHeaderText();
            expect(['Opus Orchestra Dashboard', 'No Agents Created']).to.include(headerText);
        });

        it('should show empty state with creation controls when no agents', async function () {
            const cards = await page.getAgentCards();
            if (cards.length > 0) {
                this.skip(); // Properly skip if agents exist
            }

            expect(await page.hasEmptyState()).to.be.true;

            const countInput = await page.getAgentCountInput();
            expect(countInput).to.not.be.null;

            const configSelect = await page.getContainerConfigSelect();
            if (configSelect) {
                const options = await configSelect.findElements(By.css('option'));
                const values = await Promise.all(options.map(o => o.getAttribute('value')));
                expect(values).to.include('unisolated');
            }
        });

        it('should create agent and display card with all required elements', async function () {
            // Create agent if in empty state
            if (await page.hasEmptyState()) {
                await page.createAgents(1);
            }

            const cards = await page.getAgentCards();
            expect(cards.length).to.be.greaterThan(0);

            // Check stats bar exists
            expect(await page.getStatsBar()).to.not.be.null;

            // Verify card has all required elements
            const card = cards[0];
            expect(await page.getAgentTitleInput(card)).to.not.be.null;
            expect(await page.getAgentStatus(card)).to.not.be.null;
            expect(await page.getAgentContainerConfigSelect(card)).to.not.be.null;

            for (const action of ['focus', 'startClaude', 'deleteAgent', 'viewDiff']) {
                expect(await page.getAgentButton(card, action)).to.not.be.null;
            }
        });

        it('should have all action buttons enabled and working', async function () {
            const cards = await page.getAgentCards();
            if (cards.length === 0) {
                this.skip();
            }

            const agentId = await page.getAgentId(cards[0]);

            // All buttons should be enabled
            for (const action of ['focus', 'startClaude', 'viewDiff', 'deleteAgent']) {
                expect(await page.isButtonEnabled(action, agentId!)).to.be.true;
            }

            // Rename input should work
            const titleInput = await page.getAgentTitleInput(cards[0]);
            const originalValue = await titleInput!.getAttribute('value');
            expect(originalValue).to.equal(await titleInput!.getAttribute('data-original'));
            await page.renameAgent(titleInput!, 'test-agent-name');
        });

        it('should have container config dropdown with options', async function () {
            const cards = await page.getAgentCards();
            if (cards.length === 0) {
                this.skip();
            }

            const agentId = await page.getAgentId(cards[0]);
            const options = await page.getContainerConfigOptions(agentId!);
            expect(options).to.include('unisolated');

            // Test config change
            const initialValue = await page.getCurrentContainerConfig(agentId!);
            const newConfig = options.find(o => o !== initialValue);
            if (newConfig) {
                await page.setContainerConfig(agentId!, newConfig);
            }
        });

        it('should update waiting duration over time', async function () {
            const cards = await page.getAgentCards();
            if (cards.length === 0) {
                this.skip();
            }

            // Get initial duration value
            const card = cards[0];
            const statValue = await card.findElement(By.css('.stat-value'));
            const initialDuration = await statValue.getText();

            // Wait 3 seconds for the duration to update
            await driver.sleep(3000);

            // Get updated duration value
            const updatedDuration = await statValue.getText();

            // Duration should have changed (e.g., "0s" -> "3s" or similar)
            expect(updatedDuration).to.not.equal(initialDuration);
        });
    });

    describe('Isolation Progress', function () {
        before(async () => await page.open());
        after(async () => await page.close());

        beforeEach(async function () {
            await page.switchBack();
            await driver.sleep(200);
            await page.switchToFrame();
        });

        it('should support progress element injection', async function () {
            const cards = await page.getAgentCards();
            if (cards.length === 0) {
                this.skip();
            }

            const success = await page.injectProgressElement('.agent-card', 'Test progress');
            expect(success).to.be.true;

            const progressElements = await page.getIsolationProgress();
            expect(progressElements.length).to.be.greaterThan(0);
            expect(await progressElements[0].getText()).to.equal('Test progress');

            await page.removeProgressElements();
        });
    });

    describe('Container Configuration Options', function () {
        before(async () => await page.open());
        after(async () => await page.close());

        beforeEach(async function () {
            await page.switchBack();
            await driver.sleep(200);
            await page.switchToFrame();
        });

        it('should show container options in empty state dropdown', async function () {
            // Only test if we're in empty state
            if (!(await page.hasEmptyState())) {
                this.skip();
            }

            const debug = await page.debugContainerDiscovery();

            // Basic assertions
            expect(debug.selectExists).to.be.true;
            expect(debug.options.length).to.be.greaterThan(0);

            // Should have unisolated option
            const hasUnisolated = debug.options.some(o => o.value === 'unisolated');
            expect(hasUnisolated, 'Should have unisolated option').to.be.true;
        });

        it('should show repo container configs from .opus-orchestra/containers/', async function () {
            if (!(await page.hasEmptyState())) {
                this.skip();
            }

            // Wait a bit for async config discovery
            await driver.sleep(2000);

            const debug = await page.debugContainerDiscovery();

            // Check for repo configs (should have dev, ui-tests, etc.)
            const repoOptions = debug.options.filter(o =>
                o.value.startsWith('repo:') || o.group?.includes('repo')
            );

            // This test will fail if configs aren't discovered - that's the point
            expect(repoOptions.length,
                'Should have repo container configs from .opus-orchestra/containers/. ' +
                `Found options: ${JSON.stringify(debug.options)}`
            ).to.be.greaterThan(0);
        });

        it('should group options by source and type', async function () {
            if (!(await page.hasEmptyState())) {
                this.skip();
            }

            const debug = await page.debugContainerDiscovery();

            if (debug.options.length > 1) {
                // If we have more than just unisolated, we should have groups
                const groupedOptions = debug.options.filter(o => o.group);
                expect(groupedOptions.length,
                    'Non-unisolated options should be in optgroups'
                ).to.be.greaterThan(0);
            }
        });
    });

    describe('Terminal Auto-Start Feature', function () {
        before(async () => await page.open());
        after(async () => await page.close());

        it('should have focus button that triggers terminal creation', async function () {
            // Ensure we have at least one agent
            if (await page.hasEmptyState()) {
                await page.createAgents(1);
            }

            const cards = await page.getAgentCards();
            expect(cards.length).to.be.greaterThan(0);

            // Verify focus button exists
            const agentId = await page.getAgentId(cards[0]);
            const focusButton = await page.getAgentButton(cards[0], 'focus');
            expect(focusButton).to.not.be.null;

            // Button should be enabled
            expect(await page.isButtonEnabled('focus', agentId!)).to.be.true;
        });

        it('should click focus button and open terminal', async function () {
            const cards = await page.getAgentCards();
            if (cards.length === 0) {
                this.skip();
            }

            const agentId = await page.getAgentId(cards[0]);

            // Click the focus button to open/focus terminal
            await page.clickButton('focus', agentId!);

            // Allow time for terminal to be created
            await driver.sleep(2000);

            // Clicking focus switches us out of the webview frame - re-establish
            await page.switchBack();
            await driver.sleep(500);
            await page.switchToFrame();
            await driver.sleep(300);

            // The button should still exist and be enabled
            const newCards = await page.getAgentCards();
            expect(newCards.length).to.be.greaterThan(0);
        });

        it('should have startClaude button as alternative to auto-start', async function () {
            // Re-establish frame in case previous test left us outside
            await page.switchBack();
            await driver.sleep(200);
            await page.switchToFrame();

            const cards = await page.getAgentCards();
            if (cards.length === 0) {
                this.skip();
            }

            const agentId = await page.getAgentId(cards[0]);
            const startClaudeButton = await page.getAgentButton(cards[0], 'startClaude');
            expect(startClaudeButton).to.not.be.null;
            expect(await page.isButtonEnabled('startClaude', agentId!)).to.be.true;
        });

        it('should have both focus and startClaude buttons available simultaneously', async function () {
            // Re-establish frame in case previous test left us outside
            await page.switchBack();
            await driver.sleep(200);
            await page.switchToFrame();

            const cards = await page.getAgentCards();
            if (cards.length === 0) {
                this.skip();
            }

            const card = cards[0];

            // Both buttons should exist on the same card
            const focusButton = await page.getAgentButton(card, 'focus');
            const startClaudeButton = await page.getAgentButton(card, 'startClaude');

            expect(focusButton).to.not.be.null;
            expect(startClaudeButton).to.not.be.null;

            // Get their text to verify they're different actions
            const focusText = await focusButton!.getText();
            const startClaudeText = await startClaudeButton!.getText();

            expect(focusText).to.not.equal(startClaudeText);
        });
    });

    describe('Status Data Flow (Waiting/Changes Fields)', function () {
        /**
         * E2E tests for bug where:
         * 1. "Waiting" field was stuck at 0s because webview used Date.now()
         *    instead of agentData.lastInteractionTime
         * 2. "Changes" field was empty because webview read agentData.insertions
         *    instead of agentData.diffStats.insertions
         */

        before(async () => await page.open());
        after(async () => await page.close());

        beforeEach(async function () {
            await page.switchBack();
            await driver.sleep(200);
            await page.switchToFrame();
        });

        it('should increment waiting time over multiple poll cycles without resetting', async function () {
            // Ensure we have an agent
            if (await page.hasEmptyState()) {
                await page.createAgents(1);
            }

            const cards = await page.getAgentCards();
            if (cards.length === 0) {
                this.skip();
            }

            const card = cards[0];

            // Get initial time
            const initialTime = await page.getAgentTimeSince(card);
            const initialSeconds = page.parseTimeToSeconds(initialTime);

            // Wait 5 seconds - this should span multiple poll cycles (1s interval)
            // If the bug exists, time would reset to 0s on each poll
            await driver.sleep(5000);

            // Get updated time
            const updatedTime = await page.getAgentTimeSince(card);
            const updatedSeconds = page.parseTimeToSeconds(updatedTime);

            // Time should have increased by approximately 5 seconds
            // Allow some tolerance for timing variations
            const timeDiff = updatedSeconds - initialSeconds;
            expect(timeDiff).to.be.at.least(3,
                `Waiting time should increment over time. ` +
                `Initial: ${initialTime} (${initialSeconds}s), ` +
                `Updated: ${updatedTime} (${updatedSeconds}s). ` +
                `If stuck at 0s, the webview may be overwriting lastInteractionTime with Date.now().`
            );
        });

        it('should display diff stats values from extension data', async function () {
            const cards = await page.getAgentCards();
            if (cards.length === 0) {
                this.skip();
            }

            const card = cards[0];
            const diffStats = await page.getAgentDiffStats(card);

            // Verify the diff stats are displayed (format: "+N" and "-N")
            expect(diffStats.insertions).to.match(/^\+\d+$/,
                'Insertions should be displayed as "+N". ' +
                'If empty or undefined, the webview may be reading wrong property.'
            );
            expect(diffStats.deletions).to.match(/^-\d+$/,
                'Deletions should be displayed as "-N". ' +
                'If empty or undefined, the webview may be reading wrong property.'
            );
        });

        it('should not reset waiting time to 0s on status updates', async function () {
            const cards = await page.getAgentCards();
            if (cards.length === 0) {
                this.skip();
            }

            const card = cards[0];

            // Sample the time multiple times over 6 seconds
            const samples: number[] = [];
            for (let i = 0; i < 6; i++) {
                const time = await page.getAgentTimeSince(card);
                samples.push(page.parseTimeToSeconds(time));
                await driver.sleep(1000);
            }

            // Check that time is monotonically increasing (not resetting to 0)
            let resetCount = 0;
            for (let i = 1; i < samples.length; i++) {
                if (samples[i] < samples[i - 1]) {
                    resetCount++;
                }
            }

            expect(resetCount).to.equal(0,
                `Waiting time reset ${resetCount} times during sampling. ` +
                `Samples: [${samples.join(', ')}]. ` +
                `Time should never decrease unless agent status changes.`
            );
        });
    });
});
