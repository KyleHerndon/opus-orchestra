# Terminal Improvements

## Start Claude Button
- Show "Start Claude" button if and only if the associated terminal doesn't have Claude running
- Gets around terminal timing issues with auto-start
- Remove auto-start Claude logic entirely

## Open Terminal Button
- Replace "Focus Terminal" with "Open Terminal"
- Only show if terminal is not currently open/visible
- Simpler UX - just opens the terminal, user can start Claude manually if needed
