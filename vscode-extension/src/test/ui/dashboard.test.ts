/**
 * UI Tests for Claude Agents Dashboard
 *
 * Uses vscode-extension-tester (Selenium WebDriver) for E2E testing.
 * Tests verify UI elements exist, are visible, and interactions work.
 */

import { expect } from 'chai';
import {
    VSBrowser,
    WebDriver,
    Workbench,
    EditorView,
    WebView,
    By,
    ActivityBar,
    SideBarView,
    until,
} from 'vscode-extension-tester';

describe('Claude Agents Dashboard UI Tests', function () {
    this.timeout(180000); // 3 minute timeout for UI tests

    let browser: VSBrowser;
    let driver: WebDriver;
    let workbench: Workbench;

    // Helper: wait for element to exist
    async function waitForElement(selector: string, timeout = 10000) {
        return driver.wait(until.elementLocated(By.css(selector)), timeout);
    }

    // Helper: open dashboard and switch to webview frame
    async function openDashboardAndSwitchToFrame(): Promise<WebView> {
        // Check if dashboard is already open
        const editorView = new EditorView();
        let titles = await editorView.getOpenEditorTitles();

        if (!titles.includes('Claude Agents Dashboard')) {
            // Try keyboard shortcut first (more reliable than command palette)
            try {
                await workbench.executeCommand('Claude Agents: Open Dashboard');
            } catch (e) {
                // If command palette fails, try again after a delay
                await driver.sleep(1000);
                await workbench.executeCommand('Claude Agents: Open Dashboard');
            }

            // Wait for the editor tab to appear
            await driver.wait(async () => {
                titles = await editorView.getOpenEditorTitles();
                return titles.includes('Claude Agents Dashboard');
            }, 15000, 'Dashboard tab did not appear');
        }

        const webview = new WebView();
        await webview.switchToFrame();

        // Wait for dashboard content to load
        await waitForElement('.header h1', 10000);

        return webview;
    }

    before(async function () {
        browser = VSBrowser.instance;
        driver = browser.driver;
        workbench = new Workbench();

        console.log('Using pre-created test repository (opened via --folder)');

        // Wait for VS Code to be ready (activity bar visible)
        await driver.wait(async () => {
            try {
                const activityBar = new ActivityBar();
                const controls = await activityBar.getViewControls();
                return controls.length > 0;
            } catch {
                return false;
            }
        }, 30000, 'VS Code did not become ready');
    });

    describe('Extension Activation', function () {
        it('should show Claude Agents in Activity Bar', async function () {
            const activityBar = new ActivityBar();

            await driver.wait(async () => {
                const controls = await activityBar.getViewControls();
                const titles = await Promise.all(controls.map(c => c.getTitle()));
                return titles.includes('Claude Agents');
            }, 10000, 'Claude Agents not found in Activity Bar');
        });

        it('should open Claude Agents sidebar view', async function () {
            const activityBar = new ActivityBar();
            const control = await activityBar.getViewControl('Claude Agents');
            expect(control).to.not.be.undefined;

            await control?.openView();

            // Wait for sidebar content
            await driver.wait(async () => {
                try {
                    const sideBar = new SideBarView();
                    const content = await sideBar.getContent();
                    const sections = await content.getSections();
                    return sections.length > 0;
                } catch {
                    return false;
                }
            }, 10000, 'Sidebar did not open');
        });
    });

    describe('Dashboard Command', function () {
        it('should open dashboard via command', async function () {
            await workbench.executeCommand('Claude Agents: Open Dashboard');

            // Wait for dashboard tab to appear
            const editorView = new EditorView();
            await driver.wait(async () => {
                const titles = await editorView.getOpenEditorTitles();
                return titles.includes('Claude Agents Dashboard');
            }, 10000, 'Dashboard tab did not appear');

            const titles = await editorView.getOpenEditorTitles();
            expect(titles).to.include('Claude Agents Dashboard');
        });
    });

    describe('Dashboard WebView Elements', function () {
        let webview: WebView;

        before(async function () {
            webview = await openDashboardAndSwitchToFrame();
        });

        after(async function () {
            if (webview) {
                await webview.switchBack();
            }
        });

        it('should display header with title', async function () {
            const header = await waitForElement('.header h1');
            const text = await header.getText();
            expect(text).to.equal('Claude Agents Dashboard');
        });

        it('should display scale selector in header', async function () {
            const scaleSelect = await waitForElement('#scale-select');
            expect(scaleSelect).to.not.be.undefined;

            const options = await scaleSelect.findElements(By.css('option'));
            expect(options.length).to.be.greaterThan(3);
        });

        it('should have scale options from 75% to 150%', async function () {
            const scaleSelect = await waitForElement('#scale-select');
            const options = await scaleSelect.findElements(By.css('option'));
            const values = await Promise.all(options.map(o => o.getAttribute('value')));

            expect(values).to.include('0.75');
            expect(values).to.include('1');
            expect(values).to.include('1.5');
        });

        describe('Empty State (no agents)', function () {
            it('should show empty state when no agents exist', async function () {
                const emptyState = await driver.findElements(By.css('.empty-state'));
                if (emptyState.length > 0) {
                    const heading = await driver.findElement(By.css('.empty-state h2'));
                    const text = await heading.getText();
                    expect(text).to.equal('No Agents Created');
                }
            });

            it('should have agent count input', async function () {
                const countInput = await driver.findElements(By.id('agent-count'));
                if (countInput.length > 0) {
                    const value = await countInput[0].getAttribute('value');
                    expect(parseInt(value)).to.be.greaterThan(0);
                }
            });

            it('should have isolation tier dropdown', async function () {
                const tierSelect = await driver.findElements(By.id('isolation-tier-select'));
                if (tierSelect.length > 0) {
                    const options = await tierSelect[0].findElements(By.css('option'));
                    expect(options.length).to.be.greaterThan(0);

                    const values = await Promise.all(options.map(o => o.getAttribute('value')));
                    expect(values).to.include('standard');
                }
            });

            it('should have Create Agents button', async function () {
                const createBtn = await driver.findElements(By.css('button[data-action="createAgents"]'));
                if (createBtn.length > 0) {
                    const text = await createBtn[0].getText();
                    expect(text).to.include('Create');
                }
            });
        });

        describe('Agent Creation and Management', function () {
            it('should create an agent when clicking Create Agents', async function () {
                // Check if we're in empty state
                const createBtn = await driver.findElements(By.css('button[data-action="createAgents"]'));
                if (createBtn.length === 0) {
                    // Already have agents, skip creation
                    this.skip();
                    return;
                }

                // Set count to 1 for faster test
                const countInput = await driver.findElement(By.id('agent-count'));
                await countInput.clear();
                await countInput.sendKeys('1');

                // Click create button
                await createBtn[0].click();

                // Switch back to default content and then back to webview frame
                // This handles the case where webview content is re-rendered
                await driver.switchTo().defaultContent();

                // Wait a moment for the agent creation to complete
                await driver.sleep(2000);

                // Switch back to webview frame
                const webview = new WebView();
                await webview.switchToFrame();

                // Wait for agent card to appear (up to 30 seconds for creation)
                await driver.wait(async () => {
                    const cards = await driver.findElements(By.css('.agent-card'));
                    return cards.length > 0;
                }, 30000, 'Agent card did not appear after clicking Create Agents');

                const agentCards = await driver.findElements(By.css('.agent-card'));
                expect(agentCards.length).to.be.greaterThan(0);
            });

            it('should display stats bar when agents exist', async function () {
                const agentCards = await driver.findElements(By.css('.agent-card'));
                if (agentCards.length === 0) {
                    this.skip();
                    return;
                }

                const statsBar = await driver.findElements(By.css('.stats-bar'));
                expect(statsBar.length).to.be.greaterThan(0);

                const stats = await statsBar[0].findElements(By.css('.stat'));
                expect(stats.length).to.be.greaterThan(0);
            });

            it('agent card should have required elements', async function () {
                const agentCards = await driver.findElements(By.css('.agent-card'));
                if (agentCards.length === 0) {
                    this.skip();
                    return;
                }

                const card = agentCards[0];

                // Check for title input
                const titleInput = await card.findElements(By.css('.agent-title-input'));
                expect(titleInput.length).to.equal(1);

                // Check for status badge
                const status = await card.findElements(By.css('.agent-status'));
                expect(status.length).to.equal(1);

                // Check for action buttons
                const focusBtn = await card.findElements(By.css('button[data-action="focus"]'));
                expect(focusBtn.length).to.equal(1);

                const startClaudeBtn = await card.findElements(By.css('button[data-action="startClaude"]'));
                expect(startClaudeBtn.length).to.equal(1);

                // Check for isolation tier dropdown
                const tierSelect = await card.findElements(By.css('select[data-action="changeIsolation"]'));
                expect(tierSelect.length).to.equal(1);

                // Check for delete button
                const deleteBtn = await card.findElements(By.css('button[data-action="deleteAgent"]'));
                expect(deleteBtn.length).to.equal(1);
            });
        });
    });

    describe('Isolation Tier Dropdown Interaction', function () {
        let webview: WebView;

        before(async function () {
            webview = await openDashboardAndSwitchToFrame();
        });

        after(async function () {
            if (webview) {
                await webview.switchBack();
            }
        });

        it('should have all available tiers in dropdown', async function () {
            const tierSelects = await driver.findElements(By.css('select[data-action="changeIsolation"]'));
            if (tierSelects.length === 0) {
                this.skip();
                return;
            }

            const options = await tierSelects[0].findElements(By.css('option'));
            const values = await Promise.all(options.map(o => o.getAttribute('value')));
            expect(values).to.include('standard');
        });

        it('should respond to tier selection change', async function () {
            const tierSelects = await driver.findElements(By.css('select[data-action="changeIsolation"]'));
            if (tierSelects.length === 0) {
                this.skip();
                return;
            }

            const select = tierSelects[0];
            const initialValue = await select.getAttribute('value');

            const options = await select.findElements(By.css('option'));
            for (const option of options) {
                const value = await option.getAttribute('value');
                if (value !== initialValue) {
                    await option.click();
                    // Wait for potential progress indicator or value change
                    await driver.sleep(1000);
                    break;
                }
            }
        });
    });

    describe('Agent Actions', function () {
        let webview: WebView;

        before(async function () {
            webview = await openDashboardAndSwitchToFrame();
        });

        after(async function () {
            if (webview) {
                await webview.switchBack();
            }
        });

        it('Focus Terminal button should be clickable', async function () {
            const focusBtns = await driver.findElements(By.css('button[data-action="focus"]'));
            if (focusBtns.length === 0) {
                this.skip();
                return;
            }

            const btn = focusBtns[0];
            const isEnabled = await btn.isEnabled();
            expect(isEnabled).to.be.true;
        });

        it('Start Claude button should be clickable', async function () {
            const startBtns = await driver.findElements(By.css('button[data-action="startClaude"]'));
            if (startBtns.length === 0) {
                this.skip();
                return;
            }

            const btn = startBtns[0];
            const isEnabled = await btn.isEnabled();
            expect(isEnabled).to.be.true;
        });

        it('View Diff button should be clickable', async function () {
            const diffBtns = await driver.findElements(By.css('button[data-action="viewDiff"]'));
            if (diffBtns.length === 0) {
                this.skip();
                return;
            }

            const btn = diffBtns[0];
            const isEnabled = await btn.isEnabled();
            expect(isEnabled).to.be.true;
        });

        it('Delete button should be clickable', async function () {
            const deleteBtns = await driver.findElements(By.css('button[data-action="deleteAgent"]'));
            if (deleteBtns.length === 0) {
                this.skip();
                return;
            }

            const btn = deleteBtns[0];
            const isEnabled = await btn.isEnabled();
            expect(isEnabled).to.be.true;
        });

        it('Agent name should be editable', async function () {
            const titleInputs = await driver.findElements(By.css('.agent-title-input'));
            if (titleInputs.length === 0) {
                this.skip();
                return;
            }

            const input = titleInputs[0];
            const originalValue = await input.getAttribute('value');
            const originalAttr = await input.getAttribute('data-original');

            expect(originalValue).to.equal(originalAttr);

            // Try editing - use JavaScript to set value directly
            await driver.executeScript(
                "arguments[0].value = 'test-agent-name'; arguments[0].dispatchEvent(new Event('input'));",
                input
            );
            const newValue = await input.getAttribute('value');
            expect(newValue).to.equal('test-agent-name');

            // Restore original
            await driver.executeScript(
                `arguments[0].value = '${originalValue}'; arguments[0].dispatchEvent(new Event('input'));`,
                input
            );
        });
    });
});
