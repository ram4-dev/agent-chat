# Inbox scope correction

- Repository: `/Users/ramiro/Desktop/projects/agent_chat`
- Source: `main`, `b87c434793eb44d4a70ea1e288adacc384f6ea2f`.
- Branch: `fix/inbox-scope`.
- Isolated Worktrunk worktree: `/Users/ramiro/Desktop/projects/agent_chat.fix-inbox-scope`.
- Finding: OAuth scopes are independent; consent assigns pending event recovery and ACK to `agent:inbox`, but the MCP handlers required `agent:receive`.
- Acceptance: inbox-only credentials can recover and ACK pending events but cannot open live receivers; receive-only credentials can open live receivers but cannot read or ACK inbox events. Validate through real OAuth, browser, MCP and WS in both storage modes.
- Cleanup: keep the worktree available for review; preserve all existing worktrees.

- Reproduction: both E2E cases failed against the original handlers (inbox-only recovery denied; receive-only inbox allowed). The SDK helper must pass explicit scope to override discovery defaults.
