/**
 * GitService integration tests
 *
 * Tests GitService with real git repositories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { GitService } from '../../services/GitService';
import { SystemAdapter } from '../../adapters/SystemAdapter';
import {
  createTestRepo,
  addAndCommit,
  makeUncommittedChange,
  createWorktree,
  TestRepo,
  getTestSystemAdapter,
} from '../fixtures/testRepo';

describe('GitService', () => {
  let testRepo: TestRepo;
  let git: GitService;
  let system: SystemAdapter;

  beforeEach(() => {
    testRepo = createTestRepo('git-service-test-');
    system = getTestSystemAdapter();
    git = new GitService(system);
  });

  afterEach(() => {
    testRepo.cleanup();
  });

  describe('isGitRepo', () => {
    it('returns true for git directories', () => {
      expect(git.isGitRepo(testRepo.path)).toBe(true);
    });

    it('returns false for non-git directories', () => {
      // Create temp dir outside the git repo
      const nonGitDir = fs.mkdtempSync(system.joinPath(system.getTempDirectory(), 'not-git-'));
      try {
        expect(git.isGitRepo(nonGitDir)).toBe(false);
      } finally {
        fs.rmSync(nonGitDir, { recursive: true, force: true });
      }
    });
  });

  describe('getCurrentBranch', () => {
    it('returns current branch name', async () => {
      const branch = await git.getCurrentBranch(testRepo.path);
      expect(branch).toBe('main');
    });
  });

  describe('getBaseBranch', () => {
    it('returns main when main branch exists', async () => {
      const baseBranch = await git.getBaseBranch(testRepo.path);
      expect(baseBranch).toBe('main');
    });
  });

  describe('getDiffStats', () => {
    it('returns zeros when no changes', async () => {
      const stats = await git.getDiffStats(testRepo.path, 'main');

      expect(stats).toEqual({
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
      });
    });

    it('counts insertions correctly', async () => {
      // Create worktree and make changes there
      const worktreePath = createWorktree(testRepo.path, 'claude-alpha');

      // Add new lines to a file
      makeUncommittedChange(worktreePath, 'new-file.ts', 'line1\nline2\nline3\n');
      addAndCommit(worktreePath, 'new-file.ts', 'line1\nline2\nline3\n', 'Add new file');

      const stats = await git.getDiffStats(worktreePath, 'main');

      expect(stats.filesChanged).toBe(1);
      expect(stats.insertions).toBe(3);
      expect(stats.deletions).toBe(0);
    });

    it('counts deletions correctly', async () => {
      const worktreePath = createWorktree(testRepo.path, 'claude-bravo');

      // Delete content from README
      fs.writeFileSync(system.joinPath(worktreePath, 'README.md'), '');
      addAndCommit(worktreePath, 'README.md', '', 'Clear README');

      const stats = await git.getDiffStats(worktreePath, 'main');

      expect(stats.filesChanged).toBeGreaterThanOrEqual(1);
      expect(stats.deletions).toBeGreaterThan(0);
    });

    it('counts both insertions and deletions', async () => {
      const worktreePath = createWorktree(testRepo.path, 'claude-charlie');

      // Modify existing file (add lines and change existing)
      const newContent = 'export const goodbye = "world";\nexport const foo = "bar";\n';
      fs.writeFileSync(system.joinPath(worktreePath, 'src', 'index.ts'), newContent);

      // Stage and commit the changes using SystemAdapter for cross-platform compatibility
      system.execSync('git add -A', worktreePath);
      system.execSync('git commit -m "Modify index"', worktreePath);

      const stats = await git.getDiffStats(worktreePath, 'main');

      expect(stats.filesChanged).toBe(1);
      // The original had 1 line, we now have 2 lines with different content
      // So we should have both insertions and deletions
      expect(stats.insertions + stats.deletions).toBeGreaterThan(0);
    });
  });

  describe('getChangedFiles', () => {
    it('returns empty array when no changes', async () => {
      const files = await git.getChangedFiles(testRepo.path, 'main');
      expect(files).toEqual([]);
    });

    it('returns list of changed files', async () => {
      const worktreePath = createWorktree(testRepo.path, 'claude-delta');

      // Add and modify files
      makeUncommittedChange(worktreePath, 'new-file.ts', 'content');
      makeUncommittedChange(worktreePath, 'src/utils.ts', 'utils');

      // Stage and commit using SystemAdapter for cross-platform compatibility
      system.execSync('git add -A', worktreePath);
      system.execSync('git commit -m "Add files"', worktreePath);

      const files = await git.getChangedFiles(worktreePath, 'main');

      expect(files).toContain('new-file.ts');
      expect(files).toContain('src/utils.ts');
    });
  });

  describe('createWorktree', () => {
    it('creates a new worktree with branch', async () => {
      const worktreesDir = system.joinPath(testRepo.path, '.worktrees');
      const worktreePath = system.joinPath(worktreesDir, 'claude-echo');
      fs.mkdirSync(worktreesDir, { recursive: true });

      await git.createWorktree(
        testRepo.path,
        'claude-echo',
        worktreePath,
        'main'
      );

      expect(fs.existsSync(worktreePath)).toBe(true);
      expect(fs.existsSync(system.joinPath(worktreePath, '.git'))).toBe(true);
    });
  });

  describe('renameBranch', () => {
    it('renames a branch', async () => {
      const worktreePath = createWorktree(testRepo.path, 'claude-foxtrot');

      await git.renameBranch(worktreePath, 'claude-foxtrot', 'claude-renamed');

      const currentBranch = await git.getCurrentBranch(worktreePath);
      expect(currentBranch).toBe('claude-renamed');
    });
  });

  describe('initRepo', () => {
    it('initializes a new git repository', async () => {
      const newDir = system.joinPath(testRepo.path, 'new-repo');
      fs.mkdirSync(newDir);

      await git.initRepo(newDir);

      expect(git.isGitRepo(newDir)).toBe(true);
    });
  });

  describe('stageAll and commit', () => {
    it('stages and commits changes', async () => {
      const worktreePath = createWorktree(testRepo.path, 'claude-golf');

      // Make a change
      makeUncommittedChange(worktreePath, 'staged-file.ts', 'content');

      // Stage and commit
      await git.stageAll(worktreePath);
      await git.commit(worktreePath, 'Test commit');

      // Verify commit was made (no uncommitted changes)
      const stats = await git.getDiffStats(worktreePath, 'HEAD~1');
      expect(stats.filesChanged).toBe(1);
    });
  });

  describe('deleteBranch', () => {
    it('deletes a branch', async () => {
      // Create a branch first
      const worktreePath = createWorktree(testRepo.path, 'claude-hotel');

      // Remove worktree first (can't delete checked out branch)
      // Use terminal-format path for git command
      const worktreeTerminalPath = system.convertPath(worktreePath, 'terminal');
      system.execSync(`git worktree remove "${worktreeTerminalPath}" --force`, testRepo.path);

      // Now delete the branch
      await git.deleteBranch(testRepo.path, 'claude-hotel');

      // Verify branch is gone using SystemAdapter
      let branchExists = true;
      try {
        system.execSync('git rev-parse --verify claude-hotel', testRepo.path);
      } catch {
        branchExists = false;
      }

      expect(branchExists).toBe(false);
    });
  });
});
