/**
 * GitService tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GitService } from '../../services/GitService';
import { MockSystemAdapter } from '../mocks/MockSystemAdapter';

describe('GitService', () => {
  let system: MockSystemAdapter;
  let git: GitService;

  beforeEach(() => {
    system = new MockSystemAdapter();
    git = new GitService(system);
  });

  describe('isGitRepo', () => {
    it('returns true for git directories', () => {
      system.setExecResult('git rev-parse --git-dir', '.git\n');
      expect(git.isGitRepo('/project')).toBe(true);
    });

    it('returns false for non-git directories', () => {
      system.setExecError('git rev-parse --git-dir', new Error('not a git repo'));
      expect(git.isGitRepo('/not-a-repo')).toBe(false);
    });
  });

  describe('getCurrentBranch', () => {
    it('returns current branch name', async () => {
      system.setExecResult('git branch --show-current', 'feature-branch\n');
      const result = await git.getCurrentBranch('/project');
      expect(result).toBe('feature-branch');
    });

    it('trims whitespace from branch name', async () => {
      system.setExecResult('git branch --show-current', '  main  \n');
      const result = await git.getCurrentBranch('/project');
      expect(result).toBe('main');
    });
  });

  describe('getBaseBranch', () => {
    it('returns main when main branch exists', async () => {
      system.setExecResult('git branch -l main master', '* main\n');
      const result = await git.getBaseBranch('/project');
      expect(result).toBe('main');
    });

    it('returns master when only master exists', async () => {
      system.setExecResult('git branch -l main master', '  master\n');
      const result = await git.getBaseBranch('/project');
      expect(result).toBe('master');
    });

    it('prefers main over master when both exist', async () => {
      system.setExecResult('git branch -l main master', '* main\n  master\n');
      const result = await git.getBaseBranch('/project');
      expect(result).toBe('main');
    });

    it('returns HEAD~1 when neither main nor master exist', async () => {
      system.setExecResult('git branch -l main master', '\n');
      const result = await git.getBaseBranch('/project');
      expect(result).toBe('HEAD~1');
    });

    it('returns HEAD~1 when command fails', async () => {
      system.setExecError('git branch -l main master', new Error('not a repo'));
      const result = await git.getBaseBranch('/project');
      expect(result).toBe('HEAD~1');
    });
  });

  describe('getDiffStats', () => {
    it('parses diff stats correctly', async () => {
      system.setExecResult(
        'git diff --shortstat main...HEAD',
        ' 3 files changed, 45 insertions(+), 12 deletions(-)\n'
      );

      const stats = await git.getDiffStats('/project', 'main');

      expect(stats).toEqual({
        filesChanged: 3,
        insertions: 45,
        deletions: 12,
      });
    });

    it('handles no changes', async () => {
      system.setExecResult('git diff --shortstat main...HEAD', '\n');

      const stats = await git.getDiffStats('/project', 'main');

      expect(stats).toEqual({
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
      });
    });

    it('handles insertions only', async () => {
      system.setExecResult(
        'git diff --shortstat main...HEAD',
        ' 1 file changed, 10 insertions(+)\n'
      );

      const stats = await git.getDiffStats('/project', 'main');

      expect(stats).toEqual({
        filesChanged: 1,
        insertions: 10,
        deletions: 0,
      });
    });

    it('handles deletions only', async () => {
      system.setExecResult(
        'git diff --shortstat main...HEAD',
        ' 2 files changed, 5 deletions(-)\n'
      );

      const stats = await git.getDiffStats('/project', 'main');

      expect(stats).toEqual({
        filesChanged: 2,
        insertions: 0,
        deletions: 5,
      });
    });

    it('handles single file singular form', async () => {
      system.setExecResult(
        'git diff --shortstat develop...HEAD',
        ' 1 file changed, 1 insertion(+), 1 deletion(-)\n'
      );

      const stats = await git.getDiffStats('/project', 'develop');

      expect(stats).toEqual({
        filesChanged: 1,
        insertions: 1,
        deletions: 1,
      });
    });

    it('returns zeros on error', async () => {
      system.setExecError('git diff --shortstat main...HEAD', new Error('not a repo'));

      const stats = await git.getDiffStats('/project', 'main');

      expect(stats).toEqual({
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
      });
    });
  });

  describe('getChangedFiles', () => {
    it('returns list of changed files', async () => {
      system.setExecResult(
        'git diff --name-only main...HEAD',
        'src/index.ts\nsrc/utils.ts\nREADME.md\n'
      );

      const files = await git.getChangedFiles('/project', 'main');

      expect(files).toEqual(['src/index.ts', 'src/utils.ts', 'README.md']);
    });

    it('returns empty array when no changes', async () => {
      system.setExecResult('git diff --name-only main...HEAD', '\n');

      const files = await git.getChangedFiles('/project', 'main');

      expect(files).toEqual([]);
    });

    it('returns empty array on error', async () => {
      system.setExecError('git diff --name-only main...HEAD', new Error('not a repo'));

      const files = await git.getChangedFiles('/project', 'main');

      expect(files).toEqual([]);
    });
  });

  describe('createWorktree', () => {
    it('executes git worktree add command', async () => {
      let executedCommand = '';
      const originalExec = system.exec.bind(system);
      system.exec = async (cmd: string, cwd: string) => {
        executedCommand = cmd;
        return originalExec(cmd, cwd);
      };

      await git.createWorktree('/repo', 'claude-alpha', '/repo/.worktrees/claude-alpha', 'main');

      expect(executedCommand).toContain('git worktree add');
      expect(executedCommand).toContain('claude-alpha');
      expect(executedCommand).toContain('main');
    });
  });

  describe('deleteBranch', () => {
    it('executes git branch -D command', async () => {
      let executedCommand = '';
      const originalExecSilent = system.execSilent.bind(system);
      system.execSilent = (cmd: string, cwd: string) => {
        executedCommand = cmd;
        return originalExecSilent(cmd, cwd);
      };

      await git.deleteBranch('/repo', 'feature-branch');

      expect(executedCommand).toContain('git branch -D');
      expect(executedCommand).toContain('feature-branch');
    });
  });

  describe('renameBranch', () => {
    it('executes git branch -m command', async () => {
      let executedCommand = '';
      const originalExec = system.exec.bind(system);
      system.exec = async (cmd: string, cwd: string) => {
        executedCommand = cmd;
        return originalExec(cmd, cwd);
      };

      await git.renameBranch('/repo', 'old-name', 'new-name');

      expect(executedCommand).toContain('git branch -m');
      expect(executedCommand).toContain('old-name');
      expect(executedCommand).toContain('new-name');
    });
  });

  describe('initRepo', () => {
    it('executes git init command', async () => {
      let executedCommand = '';
      const originalExec = system.exec.bind(system);
      system.exec = async (cmd: string, cwd: string) => {
        executedCommand = cmd;
        return originalExec(cmd, cwd);
      };

      await git.initRepo('/new-repo');

      expect(executedCommand).toBe('git init');
    });
  });

  describe('stageAll', () => {
    it('executes git add -A command', async () => {
      let executedCommand = '';
      const originalExec = system.exec.bind(system);
      system.exec = async (cmd: string, cwd: string) => {
        executedCommand = cmd;
        return originalExec(cmd, cwd);
      };

      await git.stageAll('/repo');

      expect(executedCommand).toBe('git add -A');
    });
  });

  describe('commit', () => {
    it('executes git commit command with message', async () => {
      let executedCommand = '';
      const originalExec = system.exec.bind(system);
      system.exec = async (cmd: string, cwd: string) => {
        executedCommand = cmd;
        return originalExec(cmd, cwd);
      };

      await git.commit('/repo', 'Initial commit');

      expect(executedCommand).toContain('git commit -m');
      expect(executedCommand).toContain('Initial commit');
    });
  });
});
