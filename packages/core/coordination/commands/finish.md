# Finish Work - Merge or Create PR

Finish your work by merging to main or creating a pull request.

## Usage
- `/finish` - Merge to main (default)
- `/finish merge` - Merge to main
- `/finish pr` - Create a pull request

## Instructions

First, check for uncommitted changes:
```bash
git status
```

If there are uncommitted changes, commit them first:
```bash
git add -A
git commit -m "Your commit message"
```

### For merge (default):

1. Get the current branch name:
```bash
git branch --show-current
```

2. Fetch latest main and merge your branch:
```bash
git fetch origin main
git checkout main
git merge <your-branch> --no-edit
git push origin main
```

3. Return to your branch (worktree requires it):
```bash
git checkout <your-branch>
```

4. Report success and let the user know they can delete this agent.

### For PR:

1. Push your branch to origin:
```bash
git push -u origin $(git branch --show-current)
```

2. Create the PR using GitHub CLI:
```bash
gh pr create --fill
```

Or if you want to customize:
```bash
gh pr create --title "Your title" --body "Description of changes"
```

3. Report the PR URL to the user.

## Notes
- Always commit any pending changes before merging or creating PR
- For merge: you'll temporarily checkout main, then return to your branch
- For PR: requires `gh` CLI to be installed and authenticated
- After successful merge, the user can delete this agent from the dashboard
