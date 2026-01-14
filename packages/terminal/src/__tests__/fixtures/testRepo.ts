/**
 * Test fixture utilities for creating temporary git repositories
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import { NodeSystemAdapter, type SystemAdapter } from '@opus-orchestra/core';

export interface TestRepo {
  path: string;
  cleanup: () => void;
}

/**
 * Default system adapter for tests.
 * Uses 'wsl' terminal type on Windows, 'bash' on Unix.
 */
function getDefaultAdapter(): SystemAdapter {
  const terminalType = os.platform() === 'win32' ? 'wsl' : 'bash';
  return new NodeSystemAdapter(terminalType);
}

/**
 * Shared adapter instance for test fixtures
 */
let sharedAdapter: SystemAdapter | null = null;

function getSharedAdapter(): SystemAdapter {
  if (!sharedAdapter) {
    sharedAdapter = getDefaultAdapter();
  }
  return sharedAdapter;
}

/**
 * Get a SystemAdapter configured for the current platform.
 * Tests should use this instead of hardcoding terminal types.
 */
export function getTestSystemAdapter(): SystemAdapter {
  return getSharedAdapter();
}

/**
 * Cached template repo path - created once, copied for each test.
 * This avoids running git init/config/commit for every test.
 */
let cachedTemplateRepo: string | null = null;

/**
 * Get or create the template git repo.
 * Runs git commands only once per test session.
 */
function getTemplateRepo(): string {
  if (cachedTemplateRepo && fs.existsSync(cachedTemplateRepo)) {
    return cachedTemplateRepo;
  }

  const adapter = getSharedAdapter();
  const tempDir = fs.mkdtempSync(adapter.joinPath(os.tmpdir(), 'opus-template-'));

  // Initialize git repo (only done once)
  adapter.execSync('git init', tempDir);
  adapter.execSync('git config user.email "test@test.com"', tempDir);
  adapter.execSync('git config user.name "Test User"', tempDir);

  // Create initial structure
  fs.writeFileSync(adapter.joinPath(tempDir, 'README.md'), '# Test Repo\n');
  fs.mkdirSync(adapter.joinPath(tempDir, 'src'), { recursive: true });
  fs.writeFileSync(adapter.joinPath(tempDir, 'src', 'index.ts'), 'export const hello = "world";\n');

  // Initial commit
  adapter.execSync('git add -A', tempDir);
  adapter.execSync('git commit -m "Initial commit"', tempDir);

  try {
    adapter.execSync('git branch -M main', tempDir);
  } catch {
    // Already on main
  }

  cachedTemplateRepo = tempDir;
  return tempDir;
}

/**
 * Create a temporary git repository for testing.
 * Uses cached template - just cp -r instead of running git commands.
 */
export function createTestRepo(prefix = 'opus-test-'): TestRepo {
  const adapter = getSharedAdapter();
  const template = getTemplateRepo();
  const tempDir = fs.mkdtempSync(adapter.joinPath(os.tmpdir(), prefix));

  // Remove empty dir created by mkdtemp, then copy template
  fs.rmSync(tempDir, { recursive: true });
  adapter.copyDirRecursive(template, tempDir);

  return {
    path: tempDir,
    cleanup: () => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Create a test repo with .opus-orchestra config directory.
 */
export function createTestRepoWithConfig(
  prefix = 'opus-test-',
  config: Record<string, unknown> = {}
): TestRepo {
  const adapter = getSharedAdapter();
  const repo = createTestRepo(prefix);

  // Create config directory
  const configDir = adapter.joinPath(repo.path, '.opus-orchestra');
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
  fs.writeFileSync(
    adapter.joinPath(configDir, 'config.json'),
    JSON.stringify(defaultConfig, null, 2)
  );

  return repo;
}

/**
 * Create a worktree in the test repo.
 */
export function createWorktree(
  repoPath: string,
  branchName: string
): string {
  const adapter = getSharedAdapter();
  const worktreeDir = adapter.joinPath(repoPath, '.worktrees');
  fs.mkdirSync(worktreeDir, { recursive: true });

  const worktreePath = adapter.joinPath(worktreeDir, branchName);
  const terminalWorktreePath = adapter.convertPath(worktreePath, 'terminal');

  adapter.execSync(`git worktree add -b "${branchName}" "${terminalWorktreePath}"`, repoPath);

  return worktreePath;
}

/**
 * Remove a worktree from the test repo.
 */
export function removeWorktree(repoPath: string, worktreePath: string): void {
  const adapter = getSharedAdapter();
  const terminalWorktreePath = adapter.convertPath(worktreePath, 'terminal');
  adapter.execSync(`git worktree remove "${terminalWorktreePath}" --force`, repoPath);
}

/**
 * Add a file to the repo and commit.
 */
export function addAndCommit(
  repoPath: string,
  filename: string,
  content: string,
  message: string
): void {
  const adapter = getSharedAdapter();
  fs.writeFileSync(adapter.joinPath(repoPath, filename), content);
  adapter.execSync('git add -A', repoPath);
  adapter.execSync(`git commit -m "${message}"`, repoPath);
}

/**
 * Make changes to a file without committing (for diff testing).
 */
export function makeUncommittedChange(
  repoPath: string,
  filename: string,
  content: string
): void {
  const adapter = getSharedAdapter();
  const filePath = adapter.joinPath(repoPath, filename);
  // Get parent directory by finding last slash
  const lastSlash = filePath.lastIndexOf('/');
  const dir = lastSlash > 0 ? filePath.substring(0, lastSlash) : filePath;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content);
}

/**
 * Get the current branch name.
 */
export function getCurrentBranch(repoPath: string): string {
  const adapter = getSharedAdapter();
  return adapter.execSync('git rev-parse --abbrev-ref HEAD', repoPath).trim();
}

/**
 * Check if a branch exists.
 */
export function branchExists(repoPath: string, branchName: string): boolean {
  const adapter = getSharedAdapter();
  try {
    adapter.execSync(`git rev-parse --verify "${branchName}"`, repoPath);
    return true;
  } catch {
    return false;
  }
}
