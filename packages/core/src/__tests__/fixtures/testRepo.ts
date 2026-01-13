/**
 * Test fixture utilities for creating temporary git repositories
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { NodeSystemAdapter } from '../../adapters/NodeSystemAdapter';
import type { SystemAdapter } from '../../adapters/SystemAdapter';

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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opus-core-template-'));

  // Initialize git repo (only done once)
  adapter.execSync('git init', tempDir);
  adapter.execSync('git config user.email "test@test.com"', tempDir);
  adapter.execSync('git config user.name "Test User"', tempDir);

  // Create initial structure
  fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test Repo\n');
  fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'src', 'index.ts'), 'export const hello = "world";\n');

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
 * Uses cached template - copies directory instead of running git commands.
 */
export function createTestRepo(prefix = 'opus-core-test-'): TestRepo {
  const adapter = getSharedAdapter();
  const template = getTemplateRepo();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

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
  prefix = 'opus-core-test-',
  config: Record<string, unknown> = {}
): TestRepo {
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
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
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
  const worktreeDir = path.join(repoPath, '.worktrees');
  fs.mkdirSync(worktreeDir, { recursive: true });

  const worktreePath = path.join(worktreeDir, branchName);
  const terminalWorktreePath = adapter.convertPath(worktreePath, 'terminal');

  adapter.execSync(`git worktree add -b "${branchName}" "${terminalWorktreePath}"`, repoPath);

  return worktreePath;
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
  fs.writeFileSync(path.join(repoPath, filename), content);
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
  const filePath = path.join(repoPath, filename);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content);
}

/**
 * Create a temporary directory for testing.
 */
export function createTempDir(prefix = 'opus-core-test-'): TestRepo {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

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
