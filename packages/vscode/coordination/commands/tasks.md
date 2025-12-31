List available tasks in the backlog.

Run this to see unclaimed tasks:
```bash
./.opus-orchestra/task-claimer.sh list-available
```

And to see which tasks are currently claimed by other agents:
```bash
./.opus-orchestra/task-claimer.sh list-claimed
```

To claim a task, use `/claim <task-name>`.
