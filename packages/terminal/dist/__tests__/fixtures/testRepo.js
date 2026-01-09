/**
 * Test fixture utilities for creating temporary git repositories
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
/**
 * Create a temporary git repository for testing.
 * Includes initial commit and basic structure.
 */
export function createTestRepo(prefix = 'opus-test-') {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    // Initialize git repo
    execSync('git init', { cwd: tempDir, stdio: 'pipe' });
    // Configure git user for commits
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'pipe' });
    // Create initial structure
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test Repo\n');
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'src', 'index.ts'), 'export const hello = "world";\n');
    // Initial commit
    execSync('git add -A', { cwd: tempDir, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'pipe' });
    // Create main branch (ensure we're on main)
    try {
        execSync('git branch -M main', { cwd: tempDir, stdio: 'pipe' });
    }
    catch {
        // Already on main or branch exists
    }
    return {
        path: tempDir,
        cleanup: () => {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
            catch {
                // Ignore cleanup errors
            }
        },
    };
}
/**
 * Create a test repo with .opus-orchestra config directory.
 */
export function createTestRepoWithConfig(prefix = 'opus-test-', config = {}) {
    const repo = createTestRepo(prefix);
    // Create config directory
    const configDir = path.join(repo.path, '.opus-orchestra');
    fs.mkdirSync(configDir, { recursive: true });
    // Write config file
    const defaultConfig = {
        useTmux: true,
        defaultAgentCount: 3,
        worktreeDirectory: '.worktrees',
        autoStartClaudeOnFocus: true,
        tmuxSessionPrefix: 'opus-test',
        diffPollingInterval: 60000,
        ...config,
    };
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(defaultConfig, null, 2));
    return repo;
}
/**
 * Create a worktree in the test repo.
 */
export function createWorktree(repoPath, worktreeName, branchName) {
    const worktreeDir = path.join(repoPath, '.worktrees');
    fs.mkdirSync(worktreeDir, { recursive: true });
    const worktreePath = path.join(worktreeDir, worktreeName);
    execSync(`git worktree add -b "${branchName}" "${worktreePath}"`, {
        cwd: repoPath,
        stdio: 'pipe',
    });
    return worktreePath;
}
/**
 * Remove a worktree from the test repo.
 */
export function removeWorktree(repoPath, worktreePath) {
    execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: repoPath,
        stdio: 'pipe',
    });
}
/**
 * Add a file to the repo and commit.
 */
export function addAndCommit(repoPath, filename, content, message) {
    fs.writeFileSync(path.join(repoPath, filename), content);
    execSync('git add -A', { cwd: repoPath, stdio: 'pipe' });
    execSync(`git commit -m "${message}"`, { cwd: repoPath, stdio: 'pipe' });
}
/**
 * Make changes to a file without committing (for diff testing).
 */
export function makeUncommittedChange(repoPath, filename, content) {
    const filePath = path.join(repoPath, filename);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content);
}
/**
 * Get the current branch name.
 */
export function getCurrentBranch(repoPath) {
    return execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: repoPath,
        encoding: 'utf-8',
    }).trim();
}
/**
 * Check if a branch exists.
 */
export function branchExists(repoPath, branchName) {
    try {
        execSync(`git rev-parse --verify "${branchName}"`, {
            cwd: repoPath,
            stdio: 'pipe',
        });
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=testRepo.js.map