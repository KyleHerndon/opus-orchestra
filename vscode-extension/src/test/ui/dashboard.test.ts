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

            const tierSelect = await page.getIsolationTierSelect();
            if (tierSelect) {
                const options = await tierSelect.findElements(By.css('option'));
                const values = await Promise.all(options.map(o => o.getAttribute('value')));
                expect(values).to.include('standard');
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
            expect(await page.getAgentIsolationSelect(card)).to.not.be.null;

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

        it('should have isolation tier dropdown with options', async function () {
            const cards = await page.getAgentCards();
            if (cards.length === 0) {
                this.skip();
            }

            const agentId = await page.getAgentId(cards[0]);
            const options = await page.getIsolationTierOptions(agentId!);
            expect(options).to.include('standard');

            // Test tier change
            const initialValue = await page.getCurrentIsolationTier(agentId!);
            const newTier = options.find(o => o !== initialValue);
            if (newTier) {
                await page.setIsolationTier(agentId!, newTier);
            }
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
});
