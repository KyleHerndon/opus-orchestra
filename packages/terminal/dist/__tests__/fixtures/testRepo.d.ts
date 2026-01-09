/**
 * Test fixture utilities for creating temporary git repositories
 */
export interface TestRepo {
    path: string;
    cleanup: () => void;
}
/**
 * Create a temporary git repository for testing.
 * Includes initial commit and basic structure.
 */
export declare function createTestRepo(prefix?: string): TestRepo;
/**
 * Create a test repo with .opus-orchestra config directory.
 */
export declare function createTestRepoWithConfig(prefix?: string, config?: Record<string, unknown>): TestRepo;
/**
 * Create a worktree in the test repo.
 */
export declare function createWorktree(repoPath: string, worktreeName: string, branchName: string): string;
/**
 * Remove a worktree from the test repo.
 */
export declare function removeWorktree(repoPath: string, worktreePath: string): void;
/**
 * Add a file to the repo and commit.
 */
export declare function addAndCommit(repoPath: string, filename: string, content: string, message: string): void;
/**
 * Make changes to a file without committing (for diff testing).
 */
export declare function makeUncommittedChange(repoPath: string, filename: string, content: string): void;
/**
 * Get the current branch name.
 */
export declare function getCurrentBranch(repoPath: string): string;
/**
 * Check if a branch exists.
 */
export declare function branchExists(repoPath: string, branchName: string): boolean;
//# sourceMappingURL=testRepo.d.ts.map