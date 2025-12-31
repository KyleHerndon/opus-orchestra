/**
 * Webview entry point
 *
 * Initializes the Svelte app and sets up message handling with the extension.
 */

import { mount } from 'svelte';
import App from './App.svelte';
import {
    repoPaths,
    containerGroups,
    loading,
    uiScale,
    updateAgent,
    addAgent,
    removeAgent,
    setAgents,
} from './stores';

// Acquire VS Code API (only once)
declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// Export for use in components
export { vscode };

// Initialize Svelte app using Svelte 5's mount API
const app = mount(App, {
    target: document.body,
});

// Handle messages from extension
window.addEventListener('message', (event) => {
    const message = event.data;

    switch (message.command) {
        case 'init': {
            // Initial state from extension
            if (message.agents) {
                setAgents(message.agents);
            }
            if (message.repoPaths) {
                repoPaths.set(message.repoPaths);
            }
            if (message.containerGroups) {
                containerGroups.set(message.containerGroups);
            }
            if (message.uiScale) {
                uiScale.set(message.uiScale);
            }
            break;
        }

        case 'updateAgents': {
            // Incremental update of agent status/stats
            for (const agentData of message.agents) {
                updateAgent(agentData.id, {
                    status: agentData.status,
                    lastInteractionTime: Date.now(),
                    diffStats: {
                        insertions: agentData.insertions,
                        deletions: agentData.deletions,
                    },
                    todoItems: agentData.todoItems || [],
                    pendingApproval: agentData.pendingApproval,
                    hasTerminal: agentData.hasTerminal,
                });
            }
            break;
        }

        case 'addCard': {
            // New agent added
            addAgent(message.agent);
            break;
        }

        case 'removeCard': {
            // Agent removed
            removeAgent(message.agentId);
            break;
        }

        case 'updateContainerOptions': {
            // Container dropdown options updated
            containerGroups.set(message.groups);
            break;
        }

        case 'loading': {
            // Loading indicator state
            loading.set({
                active: message.active,
                message: message.message || '',
                current: message.current,
                total: message.total,
            });
            break;
        }

        case 'swapCards': {
            // Drag-drop reorder (handled by extension, we just need to re-render)
            // The order is managed by the extension, so we don't need to do anything here
            break;
        }
    }
});

// Notify extension that webview is ready
vscode.postMessage({ command: 'webviewReady' });

export default app;
