/**
 * DiffView - Scrollable git diff viewer
 *
 * Shows the git diff for the selected agent with syntax highlighting.
 */
import React from 'react';
import type { TerminalAgent } from '../../types.js';
interface DiffViewProps {
    agent?: TerminalAgent;
    onBack: () => void;
}
export declare function DiffView({ agent, onBack }: DiffViewProps): React.ReactElement;
export {};
//# sourceMappingURL=DiffView.d.ts.map