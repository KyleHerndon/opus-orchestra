/**
 * Root application component
 *
 * Manages view routing, agent state, and keyboard navigation.
 */
import React from 'react';
export interface AppProps {
    /** Callback when user wants to focus an agent's tmux session */
    onFocusAgent?: (agentName: string) => void;
    /** Callback when user wants to quit */
    onQuit?: () => void;
    /** Promise to await when suspended (resolves when tmux detaches) */
    waitForResume?: () => Promise<void>;
}
export declare function App({ onFocusAgent, onQuit, waitForResume }: AppProps): React.ReactElement | null;
//# sourceMappingURL=App.d.ts.map