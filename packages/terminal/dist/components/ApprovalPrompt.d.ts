/**
 * ApprovalPrompt - Inline approval request display
 *
 * Shows pending approval with action hints.
 */
import React from 'react';
interface ApprovalPromptProps {
    description: string;
    onApprove?: () => void;
    onReject?: () => void;
}
export declare function ApprovalPrompt({ description, onApprove, onReject, }: ApprovalPromptProps): React.ReactElement;
export {};
//# sourceMappingURL=ApprovalPrompt.d.ts.map