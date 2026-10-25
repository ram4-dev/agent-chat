# Apply the UI/UX review

- Repository: /Users/ramiro/Desktop/projects/agent_chat
- Source: main at 4680f70c431a6a6d7712aea7ccaa7cff124dbf50
- Integration branch: feat/uiux-review-improvements
- Integration worktree: /Users/ramiro/Desktop/projects/agent_chat.feat-uiux-review-improvements
- User explicitly authorized subagents to apply all ten UI/UX findings.
- Evidence: /Users/ramiro/Desktop/projects/agent_chat/.local-state/uiux-review/findings.json and review.html, 34 QA screenshots.
- Four isolated worker tasks: chat UX-01/02/07; agents UX-04/05/08; mobile/docs UX-03/06; groups UX-09/10.
- Preserve green brand, existing bots, OAuth scopes, public skill/API contracts and unrelated work.
- Integrator owns shared integration, lockfile reconciliation, cross-feature testing, PR and Vercel rollout.
- Worker checkouts are app-owned T3 worktrees. Do not reset local Supabase or mutate cloud from workers; parent coordinates shared dependencies.
- Retain worktrees and task evidence for resumption.

## Integration agreements

- Chat exports `clearUserDrafts(userId)`; parent wires it to successful logout/account cleanup in App.
- ChatContainer exposes optional `onMessagesDisplayed(messageIds: readonly string[])`, with IDs in history order, only actually visible messages in a visible document. Parent wires this to the groups worker's durable human read handler.
- Read receipts must not use latest group metadata as proof that a message was seen, and never acknowledge agent inbox events.
- Canonical loopback E2E using port 4319 is serialized under `/tmp/agent-chat-uiux-e2e.lock`; independent servers use unique Portless names.
- All four task launches returned `running` on Codex `gpt-6.1-sol` with `reasoningEffort=high` and `serviceTier=default`; identifiers are in delegated-tasks.json.

## First integrated delivery

- Agent worker source 829ce1884f5b4968d7c7d1fe24228204d7a82f85 cherry-picked as a50391d.
- Updated existing browser selectors to the guided entry and named connections; manual webhook form is explicitly expanded in local/cloud tests.
- Integration typecheck and build passed.
- Adapted existing E2E run: 15 passed, 1 managed-only skipped, 1 focus expectation needed adjustment because the new direct identity trigger remains mounted.
- Focus regression now checks restoration to the retained identity trigger AND fallback to main after revocation removes its trigger. Canonical keyboard suite: 4 passed, 7.9s; no increased timeout or retry.
- Other workers still active. Full combined suites and cloud receipt checks remain pending.
