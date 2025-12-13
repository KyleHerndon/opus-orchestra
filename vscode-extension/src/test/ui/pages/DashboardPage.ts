/**
 * Page Object for the Claude Agents Dashboard WebView
 *
 * Encapsulates all dashboard interactions for E2E tests.
 * Tests should use this class instead of direct WebDriver calls.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    WebDriver,
    WebElement,
    By,
    until,
    WebView,
    Workbench,
    EditorView,
} from 'vscode-extension-tester';

export class DashboardPage {
    private webview: WebView | null = null;
    private inFrame = false;

    constructor(private driver: WebDriver) {}

    // --- Navigation ---

    async open(): Promise<void> {
        const editorView = new EditorView();
        let titles = await editorView.getOpenEditorTitles();

        if (!titles.includes('Claude Agents Dashboard')) {
            const workbench = new Workbench();
            try {
                await workbench.executeCommand('Claude Agents: Open Dashboard');
            } catch {
                await this.driver.sleep(1000);
                await workbench.executeCommand('Claude Agents: Open Dashboard');
            }

            await this.driver.wait(async () => {
                titles = await editorView.getOpenEditorTitles();
                return titles.includes('Claude Agents Dashboard');
            }, 15000, 'Dashboard tab did not appear');
        }

        this.webview = new WebView();
        await this.webview.switchToFrame();
        this.inFrame = true;

        await this.waitFor('.header h1');
    }

    async close(): Promise<void> {
        if (this.webview && this.inFrame) {
            await this.webview.switchBack();
            this.inFrame = false;
        }
    }

    async switchToFrame(): Promise<void> {
        if (this.webview && !this.inFrame) {
            await this.webview.switchToFrame();
            this.inFrame = true;
        }
    }

    async switchBack(): Promise<void> {
        if (this.webview && this.inFrame) {
            await this.webview.switchBack();
            this.inFrame = false;
        }
    }

    // --- Waiting ---

    async waitFor(selector: string, timeout = 10000): Promise<WebElement> {
        return this.driver.wait(until.elementLocated(By.css(selector)), timeout);
    }

    async waitForAgentCards(minCount = 1, timeout = 30000): Promise<WebElement[]> {
        await this.driver.wait(async () => {
            const cards = await this.getAgentCards();
            return cards.length >= minCount;
        }, timeout, `Expected at least ${minCount} agent card(s)`);
        return this.getAgentCards();
    }

    // --- Queries ---

    async getAgentCards(): Promise<WebElement[]> {
        return this.driver.findElements(By.css('.agent-card'));
    }

    async hasEmptyState(): Promise<boolean> {
        const elements = await this.driver.findElements(By.css('.empty-state'));
        return elements.length > 0;
    }

    async getHeader(): Promise<WebElement> {
        return this.driver.findElement(By.css('.header h1'));
    }

    async getHeaderText(): Promise<string> {
        const header = await this.getHeader();
        return header.getText();
    }

    async getScaleSelect(): Promise<WebElement> {
        return this.driver.findElement(By.id('scale-select'));
    }

    async getScaleOptions(): Promise<string[]> {
        const select = await this.getScaleSelect();
        const options = await select.findElements(By.css('option'));
        return Promise.all(options.map(o => o.getAttribute('value')));
    }

    async getAgentCountInput(): Promise<WebElement | null> {
        const inputs = await this.driver.findElements(By.id('agent-count'));
        return inputs[0] || null;
    }

    async getIsolationTierSelect(): Promise<WebElement | null> {
        const selects = await this.driver.findElements(By.id('isolation-tier-select'));
        return selects[0] || null;
    }

    async getStatsBar(): Promise<WebElement | null> {
        const bars = await this.driver.findElements(By.css('.stats-bar'));
        return bars[0] || null;
    }

    // --- Agent Card Queries ---

    async getAgentCardElement(card: WebElement, selector: string): Promise<WebElement | null> {
        const elements = await card.findElements(By.css(selector));
        return elements[0] || null;
    }

    async getAgentId(card: WebElement): Promise<string | null> {
        const select = await this.getAgentCardElement(card, 'select[data-action="changeIsolation"]');
        return select ? select.getAttribute('data-agent-id') : null;
    }

    async getAgentTitleInput(card: WebElement): Promise<WebElement | null> {
        return this.getAgentCardElement(card, '.agent-title-input');
    }

    async getAgentStatus(card: WebElement): Promise<WebElement | null> {
        return this.getAgentCardElement(card, '.agent-status');
    }

    async getAgentIsolationSelect(card: WebElement): Promise<WebElement | null> {
        return this.getAgentCardElement(card, 'select[data-action="changeIsolation"]');
    }

    async getAgentButton(card: WebElement, action: string): Promise<WebElement | null> {
        return this.getAgentCardElement(card, `button[data-action="${action}"]`);
    }

    // --- Actions ---

    async createAgents(count = 1): Promise<void> {
        const countInput = await this.getAgentCountInput();
        if (countInput) {
            await countInput.clear();
            await countInput.sendKeys(count.toString());
        }

        const createBtn = await this.driver.findElement(By.css('button[data-action="createAgents"]'));
        await createBtn.click();

        // Handle frame switching during creation
        await this.switchBack();
        await this.driver.sleep(2000);
        await this.switchToFrame();

        await this.waitForAgentCards(count);
    }

    async clickButton(action: string, agentId?: string): Promise<void> {
        const selector = agentId
            ? `button[data-action="${action}"][data-agent-id="${agentId}"]`
            : `button[data-action="${action}"]`;
        const btn = await this.driver.findElement(By.css(selector));
        await btn.click();
    }

    async setIsolationTier(agentId: string, tier: string): Promise<void> {
        const select = await this.driver.findElement(
            By.css(`select[data-action="changeIsolation"][data-agent-id="${agentId}"]`)
        );
        const option = await select.findElement(By.css(`option[value="${tier}"]`));
        await option.click();
        await this.driver.sleep(1000);
    }

    async getIsolationTierOptions(agentId: string): Promise<string[]> {
        const select = await this.driver.findElement(
            By.css(`select[data-action="changeIsolation"][data-agent-id="${agentId}"]`)
        );
        const options = await select.findElements(By.css('option'));
        return Promise.all(options.map(o => o.getAttribute('value')));
    }

    async getCurrentIsolationTier(agentId: string): Promise<string> {
        const select = await this.driver.findElement(
            By.css(`select[data-action="changeIsolation"][data-agent-id="${agentId}"]`)
        );
        return select.getAttribute('value');
    }

    async renameAgent(input: WebElement, newName: string): Promise<void> {
        const originalValue = await input.getAttribute('value');
        await this.driver.executeScript(
            `arguments[0].value = '${newName}'; arguments[0].dispatchEvent(new Event('input'));`,
            input
        );
        // Restore for test isolation
        await this.driver.executeScript(
            `arguments[0].value = '${originalValue}'; arguments[0].dispatchEvent(new Event('input'));`,
            input
        );
    }

    async isButtonEnabled(action: string, agentId?: string): Promise<boolean> {
        const selector = agentId
            ? `button[data-action="${action}"][data-agent-id="${agentId}"]`
            : `button[data-action="${action}"]`;
        const btns = await this.driver.findElements(By.css(selector));
        if (btns.length === 0) {
            return false;
        }
        return btns[0].isEnabled();
    }

    // --- Progress Indicators ---

    async getIsolationProgress(): Promise<WebElement[]> {
        return this.driver.findElements(By.css('.isolation-progress'));
    }

    async injectProgressElement(cardSelector: string, message: string): Promise<boolean> {
        const result = await this.driver.executeScript(`
            const card = document.querySelector('${cardSelector}');
            if (!card) return false;

            const progressEl = document.createElement('div');
            progressEl.className = 'isolation-progress';
            progressEl.textContent = '${message}';
            progressEl.style.display = 'block';

            const actionsDiv = card.querySelector('.agent-actions');
            if (actionsDiv) {
                actionsDiv.parentNode.insertBefore(progressEl, actionsDiv);
            } else {
                card.appendChild(progressEl);
            }
            return true;
        `);
        return result as boolean;
    }

    async removeProgressElements(): Promise<void> {
        await this.driver.executeScript(`
            document.querySelectorAll('.isolation-progress').forEach(el => el.remove());
        `);
    }

    // --- Cleanup ---

    async deleteAllAgents(): Promise<void> {
        const deleteButtons = await this.driver.findElements(By.css('button[data-action="deleteAgent"]'));
        for (const btn of deleteButtons) {
            await btn.click();
            await this.driver.sleep(500);
            await this.switchBack();
            await this.driver.sleep(500);
            try {
                const workbench = new Workbench();
                await workbench.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
            } catch {
                // Ignore if no confirmation needed
            }
            await this.driver.sleep(500);
            await this.switchToFrame();
        }
    }

    // --- Debugging (for AI-assisted development) ---

    async screenshot(name: string): Promise<string> {
        const screenshotDir = './test-screenshots';
        if (!fs.existsSync(screenshotDir)) {
            fs.mkdirSync(screenshotDir, { recursive: true });
        }

        const screenshot = await this.driver.takeScreenshot();
        const filePath = path.join(screenshotDir, `${name}-${Date.now()}.png`);
        fs.writeFileSync(filePath, screenshot, 'base64');
        return filePath;
    }

    async getVisibleText(): Promise<string> {
        const body = await this.driver.findElement(By.css('body'));
        return body.getText();
    }

    async debugCapture(label: string): Promise<{ screenshot: string; text: string }> {
        const screenshot = await this.screenshot(label);
        const text = await this.getVisibleText();
        return { screenshot, text };
    }
}