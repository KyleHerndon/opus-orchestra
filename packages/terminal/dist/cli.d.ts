/**
 * CLI entry point using Commander.js
 */
import { Command } from 'commander';
declare const program: Command;
export declare function run(): void;
export interface CommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
/**
 * Get the effective working directory.
 * Uses testCwd if set (for testing), otherwise process.cwd().
 */
export declare function getEffectiveCwd(): string;
/**
 * Run CLI command programmatically (for testing).
 * Captures output and returns result instead of writing to console.
 */
export declare function runCommand(args: string[], cwd?: string): Promise<CommandResult>;
export { program };
//# sourceMappingURL=cli.d.ts.map