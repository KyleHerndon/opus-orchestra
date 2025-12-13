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

        it('should display header and scale selector', async function () {
            expect(await page.getHeaderText()).to.equal('Claude Agents Dashboard');

            const options = await page.getScaleOptions();
            expect(options).to.include.members(['0.75', '1', '1.5']);
        });

        it('should show empty state with creation controls when no agents', async function () {
            const cards = await page.getAgentCards();
            if (cards.length > 0) {
                return; // Skip if agents exist
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
});
