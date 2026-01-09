/**
 * Root application component
 *
 * Manages view routing, agent state, and keyboard navigation.
 */
import React from 'react';
export interface AppProps {
    /** Callback when user wants to focus an agent's tmux session */
    onFocusAgent?: (agentName: string) => void;
}
export declare function App({ onFocusAgent }: AppProps): React.ReactElement;
//# sourceMappingURL=App.d.ts.map