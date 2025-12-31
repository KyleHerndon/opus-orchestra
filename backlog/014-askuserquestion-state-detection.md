# AskUserQuestion Tool State Detection

## Summary

Opus Orchestra doesn't correctly detect when Claude is in the `AskUserQuestion` tool state, causing incorrect status display in the agent cards/dashboard.

## Current Behavior

When Claude calls the `AskUserQuestion` tool (presenting choices to the user via the CLI), the agent status tracking doesn't recognize this state. The UI may show the agent as "working" or another incorrect state instead of showing it's waiting for user input.

## Expected Behavior

When Claude calls the `AskUserQuestion` tool:
- Agent status should show "Waiting for user input" or similar
- The UI should indicate the agent needs attention
- Potentially show a notification or highlight that user interaction is required

## Technical Context

The `AskUserQuestion` tool is a Claude Code built-in that presents multi-choice questions to users. The tool output includes a distinctive prompt format with options like:
```
What is your favorite programming language?

> 1. JavaScript
  2. Python
  3. Rust
  4. Type something.

Enter to select...
```

## Implementation Considerations

1. **Detection Method**: Parse terminal output for AskUserQuestion patterns, or detect the specific tool call markers in Claude's output
2. **State Machine Update**: Add `waiting_for_question` or similar state to AgentStatusTracker
3. **UI Indication**: Show appropriate status in agent cards (similar to approval pending)

## Related

- 009-ui-improvements.md (status display)
- AgentStatusTracker in core
