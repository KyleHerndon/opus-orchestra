/**
 * Test Utilities for UI Tests
 *
 * Provides setup/teardown for test repository and agents.
 * Uses WSL for git operations (called from Windows via wsl.exe)
 */

import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';

const TEST_REPO_BASE = 'opus-orchestra-test-repo';

// Track created repos for cleanup
const createdRepos: string[] = [];

/**
 * Check if running on Windows
 */
function isWindows(): boolean {
    return process.platform === 'win32';
}

/**
 * Run a command in WSL from Windows
 */
function wslExec(command: string, cwd?: string): void {
    if (isWindows()) {
        const wslCwd = cwd ? toWslPath(cwd) : undefined;
        const fullCmd = wslCwd ? `cd "${wslCwd}" && ${command}` : command;
        execSync(`wsl.exe bash -c "${fullCmd.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
    } else {
        execSync(command, { cwd, stdio: 'ignore' });
    }
}

/**
 * Convert Windows path to WSL path
 */
function toWslPath(winPath: string): string {
    // C:\Users\... -> /mnt/c/Users/...
    return winPath.replace(/^([A-Za-z]):/, (_, letter) => `/mnt/${letter.toLowerCase()}`).replace(/\\/g, '/');
}

/**
 * Get the path to a test repository (Windows path)
 */
export function getTestRepoPath(suffix?: string): string {
    const name = suffix ? `${TEST_REPO_BASE}-${suffix}` : TEST_REPO_BASE;
    return `${os.tmpdir()}/${name}`;
}

/**
 * Create a temporary git repository for testing
 * @param suffix Optional suffix to make repo path unique (for parallel tests)
 */
export function createTestRepo(suffix?: string): string {
    const uniqueSuffix = suffix || Date.now().toString();
    const repoPath = getTestRepoPath(uniqueSuffix);

    // Clean up if exists
    if (fs.existsSync(repoPath)) {
        cleanupRepo(repoPath);
    }

    // Create directory
    fs.mkdirSync(repoPath, { recursive: true });

    // Initialize git repo using WSL
    wslExec('git init', repoPath);
    wslExec('git config user.email "test@test.com"', repoPath);
    wslExec('git config user.name "Test User"', repoPath);

    // Create initial commit
    const readmePath = `${repoPath}/README.md`;
    fs.writeFileSync(readmePath, '# Test Repository\n\nThis is a test repository for Claude Agents UI tests.\n');
    wslExec('git add .', repoPath);
    wslExec('git commit -m "Initial commit"', repoPath);

    // Track for cleanup
    createdRepos.push(repoPath);

    return repoPath;
}

/**
 * Clean up a specific repository
 */
function cleanupRepo(repoPath: string): void {
    if (!fs.existsSync(repoPath)) {
        return;
    }

    try {
        // First, try to remove any worktrees using WSL git
        const worktreesDir = `${repoPath}/.worktrees`;
        if (fs.existsSync(worktreesDir)) {
            const worktrees = fs.readdirSync(worktreesDir);
            for (const wt of worktrees) {
                try {
                    const wtPath = toWslPath(`${worktreesDir}/${wt}`);
                    wslExec(`git worktree remove --force "${wtPath}"`, repoPath);
                } catch {
                    // Ignore errors
                }
            }
        }

        // Use WSL to remove since it handles git files better
        if (isWindows()) {
            try {
                wslExec(`rm -rf "${toWslPath(repoPath)}"`, undefined);
            } catch {
                // Fall back to Node.js fs
                fs.rmSync(repoPath, { recursive: true, force: true });
            }
        } else {
            fs.rmSync(repoPath, { recursive: true, force: true });
        }
    } catch {
        // Cleanup failures are non-fatal
    }
}

/**
 * Clean up the default test repository (backward compatibility)
 */
export function cleanupTestRepo(): void {
    // Clean up all tracked repos
    for (const repoPath of createdRepos) {
        cleanupRepo(repoPath);
    }
    createdRepos.length = 0;

    // Also try to clean up the default path
    cleanupRepo(getTestRepoPath());
}

/**
 * Get Windows path from WSL path (for test configuration)
 */
export function toWindowsPath(wslPath: string): string {
    if (wslPath.startsWith('/mnt/')) {
        // /mnt/c/... -> C:/...
        return wslPath.replace(/^\/mnt\/([a-z])\//, '$1:/');
    }
    if (wslPath.startsWith('/tmp/')) {
        // WSL /tmp -> Windows temp via environment
        const winTemp = process.env.TEMP || process.env.TMP || 'C:/Temp';
        return wslPath.replace('/tmp/', winTemp.replace(/\\/g, '/') + '/');
    }
    return wslPath;
}
