# GitHub Issues Integration

## Summary

Sync GitHub issues into the backlog so agents can pull tasks directly from your issue tracker.

## Motivation

Many projects already track work in GitHub Issues. Manually copying issues into a local backlog file is tedious and error-prone. Direct integration allows:
- Single source of truth for tasks
- Automatic sync of new issues
- Status updates flow back to GitHub
- Labels/milestones map to task categories

## Design

### Two-Way Sync

```
GitHub Issues ←──────→ Opus Orchestra Backlog

- New issue created   → Task added to backlog
- Issue closed        → Task marked complete
- Task assigned       → Issue assignee updated
- Agent completes     → Issue closed + PR linked
```

### Issue → Task Mapping

| GitHub Field | Task Field |
|--------------|------------|
| Title | `title` |
| Body | `description` |
| Labels | `categories`, `priority` |
| Milestone | `milestone` |
| Assignee | `assignedTo` (agent name) |
| Issue number | `externalId` |
| State | `status` |

### Settings UI

All GitHub integration settings exposed in a dedicated settings panel:

**Dashboard Settings Tab** (or dedicated GitHub panel):
```
┌─────────────────────────────────────────────────────────┐
│ GitHub Integration                              [ON/OFF]│
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Repository: [owner/repo____________] [Detect from git]  │
│                                                         │
│ Authentication:                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ○ Use GitHub CLI (gh) - Recommended                 │ │
│ │ ○ Personal Access Token                             │ │
│ │   [••••••••••••••••••] [Show] [Test Connection]    │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Sync Settings:                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Poll interval: [5 minutes ▼]                        │ │
│ │                                                     │ │
│ │ Include issues with labels:                         │ │
│ │ [agent-task] [x]  [opus] [x]  [+ Add label]        │ │
│ │                                                     │ │
│ │ Exclude issues with labels:                         │ │
│ │ [wontfix] [x]  [duplicate] [x]  [+ Add label]      │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Priority Labels:                                        │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Label          Priority                             │ │
│ │ [critical___]  [1 - Highest ▼]  [Remove]           │ │
│ │ [high________]  [2 ▼]            [Remove]           │ │
│ │ [medium______]  [3 ▼]            [Remove]           │ │
│ │ [+ Add priority mapping]                            │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Category Labels:                                        │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ [frontend] [backend] [docs] [tests] [+ Add]        │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Automation:                                             │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ [✓] Auto-close issues when agent completes          │ │
│ │ [✓] Auto-create PR on completion                    │ │
│ │ [✓] Add "in-progress" label when assigned           │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ [Sync Now]  [View Sync Log]     Last sync: 2 min ago   │
└─────────────────────────────────────────────────────────┘
```

**Quick Access**:
- Gear icon on Backlog panel header opens GitHub settings directly
- Status indicator shows sync state (synced, syncing, error)
- Right-click backlog → "Configure GitHub Integration"

### Workflow

**Pull Issues into Backlog**:
1. Fetch issues with configured labels via GitHub API
2. Convert to task format
3. Add to backlog (or update existing)
4. Display in sidebar backlog view

**Agent Claims Task**:
1. Conductor assigns issue to agent
2. Update GitHub issue assignee
3. Add "in-progress" label
4. Agent begins work

**Agent Completes Task**:
1. Agent commits changes
2. Extension creates PR (if enabled)
3. PR description references issue (`Closes #123`)
4. Issue auto-closes when PR merges

### UI Integration

**Backlog Sidebar**:
- GitHub issues show with GitHub icon
- Sync status badge (synced/stale/error)
- Click to open issue in browser
- Context menu: "View on GitHub", "Refresh from GitHub"

**Dashboard**:
- Agent cards show linked issue number
- Link to GitHub issue and PR
- Sync status in header

**Commands** (Command Palette):
- "Opus Orchestra: Configure GitHub Integration"
- "Opus Orchestra: Sync GitHub Issues"
- "Opus Orchestra: Create Issue from Task"
- "Opus Orchestra: Link Task to Issue"

### Authentication

**IMPORTANT: Extension-Only Access**

GitHub API access is handled by the **extension only**, not by agents. Agents never have direct access to GitHub credentials or the `gh` CLI authentication.

Options presented in settings UI:
1. **GitHub CLI** (`gh`): Extension uses `gh` to make API calls on behalf of the user
2. **Personal Access Token**: Stored securely in VS Code secrets, used by extension only

**Security Model**:
- Extension makes all GitHub API calls
- Agents cannot run `gh` commands that use your auth
- Agents cannot access `~/.config/gh/hosts.yml`
- Containerized agents have no access to host credentials
- Standard agents should have `gh` commands blocked or require approval

Token input shows:
- Masked input field with show/hide toggle
- "Test Connection" button to verify
- Link to GitHub token creation page
- Required scopes listed

Required scopes:
- `repo` - for private repos
- `public_repo` - for public repos only

### Repository Configuration

For per-repo defaults, support `.opus-orchestra/github.json`:
```json
{
  "syncLabels": ["opus-orchestra", "agent-task"],
  "excludeLabels": ["wontfix", "duplicate"],
  "priorityLabels": {
    "critical": 1,
    "high": 2
  },
  "categoryLabels": ["frontend", "backend"]
}
```

This merges with user settings (user settings override repo defaults).

### Implementation Steps

1. **Settings UI Component**:
   - Create GitHub settings panel/tab
   - Form validation and feedback
   - "Test Connection" functionality
   - Settings persistence to VS Code config
2. **GitHub API Client**: Wrapper around `gh` CLI or REST API
3. **Issue Sync Service**:
   - `fetchIssues()`: Get issues matching criteria
   - `syncToBacklog()`: Convert and merge into backlog
   - `updateIssue()`: Push status changes back
4. **Backlog Integration**:
   - Add `source: "github"` and `externalId` fields to tasks
   - Preserve local-only tasks
   - Handle conflicts (GitHub wins by default)
5. **PR Creation**:
   - After agent completes, create PR via API
   - Link to issue in description
   - Apply appropriate labels
6. **Sync Status Indicators**:
   - Last sync time display
   - Error state handling
   - Manual sync button
7. **Repo Config Parser**: Read `.opus-orchestra/github.json`

## Open Questions

1. **Conflict resolution**: What if issue updated on GitHub while agent is working?
2. **Multiple repos**: Support issues from multiple repos in one workspace?
3. **Projects/Boards**: Integrate with GitHub Projects for Kanban view?
4. **Webhook vs Polling**: Webhooks would be more efficient but require setup

## Dependencies

- GitHub account with appropriate permissions
- `gh` CLI (optional, for easier auth)
- Network access to GitHub API

## Risks

- Rate limiting on GitHub API → implement backoff, show in UI
- Token security → use VS Code secrets API
- Stale data → show last sync time, manual refresh option
