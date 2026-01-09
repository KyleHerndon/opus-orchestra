/**
 * ConfirmDialog - Confirmation dialog overlay
 */
import React from 'react';
interface ConfirmDialogProps {
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
}
export declare function ConfirmDialog({ message, confirmLabel, cancelLabel, onConfirm, onCancel, }: ConfirmDialogProps): React.ReactElement;
export {};
//# sourceMappingURL=ConfirmDialog.d.ts.map