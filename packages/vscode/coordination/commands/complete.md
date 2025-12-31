Mark your current task as complete.

First, check what task you have claimed:
```bash
./.opus-orchestra/task-claimer.sh my-task "$(git branch --show-current)"
```

Then mark it complete:
```bash
./.opus-orchestra/task-claimer.sh complete "<task-name>" "$(git branch --show-current)"
```

After completing, you can claim a new task with `/claim <task-name>` or run `/tasks` to see available options.
