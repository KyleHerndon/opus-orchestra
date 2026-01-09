Claim a task from the backlog.

Task to claim: $ARGUMENTS

Run this command to claim the task:
```bash
./.opus-orchestra/task-claimer.sh claim "$ARGUMENTS" "$(git branch --show-current)"
```

After claiming, read the task file at `.opus-orchestra/backlog/$ARGUMENTS.md` and begin working on it.
