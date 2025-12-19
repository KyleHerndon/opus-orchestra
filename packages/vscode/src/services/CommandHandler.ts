/**
 * CommandHandler - Processes commands and tracks operation progress
 *
 * This service:
 * 1. Subscribes to command events from the EventBus
 * 2. Delegates to AgentManager for actual work
 * 3. Emits operation progress events for UI feedback
 */

import { OperationType } from '../types';
import { getEventBus } from './EventBus';
import { getLogger, isLoggerInitialized } from './Logger';

/**
 * Operation context for tracking progress
 */
export interface OperationContext {
    operationId: string;
    type: OperationType;
    startTime: number;
}

/**
 * CommandHandler implementation
 */
export class CommandHandler {
    private activeOperations: Map<string, OperationContext> = new Map();

    private debugLog(message: string): void {
        if (isLoggerInitialized()) {
            getLogger().child('CommandHandler').debug(message);
        }
    }

    /**
     * Generate a unique operation ID
     */
    generateOperationId(): string {
        return `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Start tracking an operation
     */
    startOperation(type: OperationType, message: string): OperationContext {
        const operationId = this.generateOperationId();
        const context: OperationContext = {
            operationId,
            type,
            startTime: Date.now(),
        };

        this.activeOperations.set(operationId, context);
        this.debugLog(`Operation started: ${type} (${operationId})`);

        getEventBus().emit('operation:started', {
            operationId,
            type,
            message,
        });

        return context;
    }

    /**
     * Report progress on an operation
     */
    reportProgress(context: OperationContext, current: number, total: number, message: string): void {
        this.debugLog(`Operation progress: ${context.type} ${current}/${total}`);

        getEventBus().emit('operation:progress', {
            operationId: context.operationId,
            type: context.type,
            current,
            total,
            message,
        });
    }

    /**
     * Complete an operation successfully
     */
    completeOperation(context: OperationContext, message?: string): void {
        const duration = Date.now() - context.startTime;
        this.activeOperations.delete(context.operationId);
        this.debugLog(`Operation completed: ${context.type} (${duration}ms)`);

        getEventBus().emit('operation:completed', {
            operationId: context.operationId,
            type: context.type,
            message,
        });
    }

    /**
     * Fail an operation
     */
    failOperation(context: OperationContext, error: string): void {
        const duration = Date.now() - context.startTime;
        this.activeOperations.delete(context.operationId);
        this.debugLog(`Operation failed: ${context.type} - ${error} (${duration}ms)`);

        getEventBus().emit('operation:failed', {
            operationId: context.operationId,
            type: context.type,
            error,
        });
    }

    /**
     * Check if an operation type is currently active
     */
    isOperationActive(type: OperationType): boolean {
        for (const op of this.activeOperations.values()) {
            if (op.type === type) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get all active operations
     */
    getActiveOperations(): OperationContext[] {
        return Array.from(this.activeOperations.values());
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.activeOperations.clear();
    }
}

/**
 * Singleton instance
 */
let commandHandlerInstance: CommandHandler | null = null;

/**
 * Get the global CommandHandler instance
 */
export function getCommandHandler(): CommandHandler {
    if (!commandHandlerInstance) {
        commandHandlerInstance = new CommandHandler();
    }
    return commandHandlerInstance;
}

/**
 * Reset the global CommandHandler instance (for testing)
 */
export function resetCommandHandler(): void {
    if (commandHandlerInstance) {
        commandHandlerInstance.dispose();
    }
    commandHandlerInstance = null;
}
