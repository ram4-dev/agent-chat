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

## Second integrated delivery

- Mobile/docs source daae038e607d07b8cb5ed1c2a1b63dc3f8b1f620 cherry-picked as b71f0b6.
- Canonical Markdown/OpenAPI/skills remain compatible; human docs now use local traced assets and escaped limited-dialect rendering. Native modal contract remains intact; Button/Field are compatible exports.
- Combined agents + mobile/docs lint, typecheck and build passed.
- Combined browser run (mobile-docs, agent-guided-setup, accessibility, keyboard-regressions, focus-handoff and ui-redesign): 24 passed, 24.2s, canonical SQLite under shared port lock.
- Independent read-only review task recorded in review-round-1.json targets exact snapshot b71f0b6. Findings pending; no whole-change approval claimed.
- Chat and group/unread implementation workers remain active. No PR or production deployment yet.

## All implementation slices integrated

- Chat d40d870 -> c437f0b; groups b8bcef6 -> 6983375. Managed services metadata and group modifications merged without conflict.
- Parent wired clearUserDrafts on confirmed logout and prior-account/session invalidation; group 401 ends the local session. Failed logout keeps drafts.
- Actual-display callback is now typed directly in App; added focus restoration re-emission to the observer to match the read queue's document.hasFocus guard.
- Added the human read table to the fixed schema inventory, without removing assertions.
- Independent review 1 found modal dismissal under pending requests (P2) and persistent receiver guide confusion (P3). Original agent worker is fixing both under task node:delegated-task:command%3Amcp%3Ac948eb01-ecbd-40ec-a8f4-9aa26b239f55%3Athread-send%3Auiux-agents-fix-review-r1. No scope-wide approval claimed.

## Review findings and fixes

- Agents follow-up e965db59 integrated as 0a6ba28: pending requests are dismissible with client abort, credential cleanup and stale-session guards; connected persistent receivers no longer funnel into mandatory webhook setup.
- Independent chat/group review f034f8f found formatted-mention and duplicate-name identity reconciliation issues. Original chat worker is fixing them under task node:delegated-task:command%3Amcp%3Ac948eb01-ecbd-40ec-a8f4-9aa26b239f55%3Athread-send%3Auiux-chat-fix-review-r2.
- Parent fixed occluded reads: narrow-layout navigation/details and App dialogs disable the read queue; generic native-dialog/inert mutations suspend pending batches and visible-ID reporting, then resume on uncover. New unit checks passed (13 focused tests); full group browser suite 8/8 passed, including navigation, details and dialog covers with client-clock batching checks.
- Full combined initial baseline: 208 unit, 16 contract, 237 SQLite integration and 20 managed tests passed. Monolithic SQLite E2E had 52 pass/8 fail; failures are authenticated test-account creation/OAuth receiving actual HTTP429 from the unchanged anonymous-IP budget, not assertion or timeout failures hidden as success.
- Full browser commands now use four standard sequential Playwright shards, each with a fresh configured server/database lifecycle and retained per-shard artifacts. No limiter mocks, production budget changes, automatic retries or timeout increases. Explicit selectors or external origins retain native CLI behavior.
- Supabase local migration 20261025000300 applied by the parent during local reset, and managed unit/integration tests passed. No new cloud schema mutation yet.
