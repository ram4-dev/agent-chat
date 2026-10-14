# 05 — Structure Outline: Agent Chat MVP

Task slug: `agent-chat-mvp`
Artifact revision: **1 (draft × blanket authorization)**
Status: **authorized by standing user approval of all phases**
Controlling artifacts: `03-prd.md` revision 2 (approved), `04-tdd.md` System Design revision 2 (approved) and Program Design revision 1 (approved)

> This outline defines reviewable vertical slices, the files each slice owns, and the checks that
> prove them. It authorizes no push, pull request, merge, or release.

## Delivery rules for every slice

- Strict TDD: observe a failing check first, then the smallest passing change, then refactor.
- One writer. No parallel writers, no parallel worktrees.
- Implementation happens in a dedicated worktree, never in the primary checkout.
- One work-unit commit per slice, or per coherent sub-unit when a slice is large. Tests and docs
  travel inside the same commit as the behavior they protect.
- A slice is complete only when its automated checks pass and its manual check (if any) was
  observed. Otherwise it stays open with the blocker recorded.

## Slice status

| Slice | Status | Commit | Evidence |
|---|---|---|---|
| S1 — Walking skeleton and test harness | done | `0b9eeb5` | lint, typecheck, 36 unit, 8 contract, 31 integration, build, 3 Playwright tests all pass; migration ledger and constraint tests observed green |
| S2 — Human identity, private groups, invitations | pending | — | — |
| S3 — Realtime human chat | pending | — | — |
| S4 — OAuth connection, agent identity, consent | pending | — | — |
| S5 — MCP tool surface and idempotent sending | pending | — | — |
| S6 — Durable inbox lifecycle | pending | — | — |
| S7 — Agent receiver WebSocket and live delivery | pending | — | — |
| S8 — Revocation and activity record | pending | — | — |
| S9 — Full-loop verification and documentation | pending | — | — |

## Slice plan

### S1 — Walking skeleton and test harness

- **Observable outcome:** `pnpm verify` runs; the server boots against a temporary SQLite file;
  migration `0001_initial_mvp` applies cleanly to an empty database; the built web app is served
  from the same origin.
- **Files:** workspace root (`pnpm-workspace.yaml`, `package.json`, `tsconfig*.json`,
  `vitest.config.ts`, `playwright.config.ts`, `.gitignore`, `README.md`), `apps/server/src/main.ts`,
  `apps/server/src/config/`, `apps/server/src/persistence/`, `packages/contracts/src/domain/`,
  `db/migrations/0001_initial_mvp.sql`, `tests/integration/migrations.test.ts`.
- **Automated checks:** lint, typecheck, migration apply/rollback-safety test, empty-database
  constraint test (immutable owner trigger, one-author-set check, unique constraints).
- **Real-route check:** start the server and request a liveness endpoint plus the served web shell.
- **Manual check:** none beyond the app loading in a browser.
- **Stop condition:** the migration cannot be applied twice safely, or the harness cannot create
  an isolated database per test worker.

### S2 — Human identity, private groups, invitations

- **Observable outcome:** a person registers and logs in; creates a private group and becomes its
  admin; invites a second person who joins; a non-member cannot see the group or its members.
- **Files:** `apps/server/src/modules/auth/`, `apps/server/src/modules/identity/`,
  `apps/server/src/modules/groups/`, `apps/server/src/adapters/http/`, `packages/contracts/src/http/`,
  `apps/web/src/features/auth/`, `apps/web/src/features/groups/`, matching unit/integration tests.
- **Automated checks:** unit tests for password/session policy and group policies; integration
  tests for registration, login, invitation single-use and expiry, admin-only membership
  mutation, last-admin protection, and non-member denial without leakage.
- **Real-route check (AC2):** browser flow for register → create group → invite → accept, plus a
  negative browser/API check that a non-member gets no group content.
- **Manual check:** responsive layout of group and member views.
- **Stop condition:** denial responses leak group existence, or the last-admin rule can be
  bypassed through concurrent mutations.

### S3 — Realtime human chat

- **Observable outcome (AC1):** two people in one private group exchange messages and each sees the
  other's message appear without reloading; authorship is attributed correctly.
- **Files:** `apps/server/src/modules/messaging/`, `apps/server/src/adapters/browser-ws/`,
  `apps/server/src/realtime/`, `packages/contracts/src/websocket/`,
  `apps/web/src/features/chat/`, matching tests.
- **Automated checks:** unit tests for message validation, cursor pagination, and limits;
  integration tests for browser socket authentication, origin check, membership-scoped
  subscription, and ordering.
- **Real-route check:** Playwright test with two browser contexts asserting live receipt and
  cursor-based catch-up after a forced disconnect.
- **Manual check:** message list and composer on a narrow viewport.
- **Stop condition:** socket events bypass membership checks, or a socket can subscribe to a group
  the session does not belong to.

### S4 — OAuth connection, agent identity, consent

- **Observable outcome (AC3, partial AC4/AC5):** an owner completes MCP OAuth in a browser,
  creates or links an agent identity, and reconnects to the same identity without creating a
  duplicate member; agent credentials cannot act as the human.
- **Files:** `apps/server/src/adapters/oauth/`, `apps/server/src/modules/identity/` (agent and
  connection policies), `packages/contracts/src/http/` (consent contracts),
  `apps/web/src/features/agents/`, matching tests.
- **Automated checks:** integration tests for PKCE `S256`, exact redirect matching, state
  validation, single-use codes, discovery metadata, scope grants, refresh rotation, refresh-reuse
  revocation, and identity stability across connections.
- **Real-route check (AC3):** real browser consent flow driving an OAuth-capable MCP SDK client;
  identity is identical across two consecutive authorizations.
- **Manual check:** consent screen copy states agent-only authority and cannot be read as owner
  delegation.
- **Stop condition:** an agent token can reach any owner-scoped action, or a reconnect creates a
  second agent member.

### S5 — MCP tool surface and idempotent sending

- **Observable outcome (AC6, AC8):** the agent lists only its groups, reads their messages, and
  publishes spontaneously without a prior mention; a retry with the same idempotency key produces
  exactly one message.
- **Files:** `apps/server/src/adapters/mcp/`, `apps/server/src/modules/messaging/`,
  `packages/contracts/src/mcp/`, `tests/contracts/mcp.test.ts`, integration tests.
- **Automated checks:** contract tests for the six tool schemas and stable error codes;
  integration tests for token audience/expiry/scope enforcement, current-state authorization,
  authorship derived from the token, and concurrent same-key sends.
- **Real-route check (AC6):** a real MCP client calls `get_identity`, `list_groups`,
  `read_messages`, and `send_message` and the message appears in the browser.
- **Manual check:** an agent message shows its own name and its visible human owner.
- **Stop condition:** a caller-supplied author can influence authorship, or a duplicate message
  survives a retry.

### S6 — Durable inbox lifecycle

- **Observable outcome (AC10, AC11):** an event created while the receiver is absent stays pending
  and is retrievable after reconnect; acknowledgement clears pending state once and history reads
  never acknowledge.
- **Files:** `apps/server/src/modules/inbox/`, `apps/server/src/adapters/mcp/` (inbox tools),
  `tests/integration/inbox.test.ts`.
- **Automated checks:** integration tests for one event per agent/message, monotonic agent-local
  sequence, pending ordering and page limits, idempotent acknowledgement, and reauthorization
  that hides events from groups the agent left.
- **Real-route check (AC10–AC11):** publish with no receiver, retrieve through MCP, read history
  without acknowledging, acknowledge, then confirm absence from pending results.
- **Manual check:** UI never presents a pending event as proof the agent ran.
- **Stop condition:** acknowledgement loses events before they are processed, or stale membership
  still discloses removed group content.

### S7 — Agent receiver WebSocket and live delivery

- **Observable outcome (AC9):** while an owner-run receiver holds an authenticated socket, a newly
  posted message reaches it live; with no socket, nothing is awakened and no message is produced
  automatically.
- **Files:** `apps/server/src/adapters/agent-ws/`, `apps/server/src/realtime/`,
  `packages/contracts/src/websocket/`, `tests/integration/agent-ws.test.ts`,
  `tests/e2e/agent-receiver.test.ts`.
- **Automated checks:** integration tests for upgrade-time credential validation, URL-token
  rejection, per-emission reauthorization, socket caps, and post-commit ordering.
- **Real-route check (AC9):** a real receiver client observes the event; the same test asserts
  that no message is sent unless the runtime explicitly sends one.
- **Manual check:** the group UI shows reception state without implying automatic replies.
- **Stop condition:** live delivery clears or creates pending state, or an unauthenticated or
  revoked socket receives any event.

### S8 — Revocation and activity record

- **Observable outcome (AC7):** revoking a connection or an agent immediately blocks reads,
  writes, refresh, and live delivery while prior messages keep author and owner.
- **Files:** `apps/server/src/modules/identity/`, `apps/server/src/modules/audit/`,
  `apps/server/src/adapters/*/`, integration tests.
- **Automated checks:** integration tests for immediate denial after revocation, socket closure,
  refresh rejection, preserved authorship, and audit rows that contain no credentials or bodies.
- **Real-route check (AC7):** revoke during an active session; the next MCP call fails and the
  history still shows the original agent authorship.
- **Manual check:** revocation confirmation copy states what survives.
- **Stop condition:** a revoked credential succeeds once more, or audit data contains secrets.

### S9 — Full-loop verification and documentation

- **Observable outcome (AC12):** one real-route run covers browser + server + SQLite + OAuth +
  MCP client + agent receiver, including live receipt and reconnect recovery.
- **Files:** `tests/e2e/`, `README.md`, `90-verification.md`, `.agent-workflow` evidence updates.
- **Automated checks:** the full `pnpm verify` chain plus the single combined E2E scenario.
- **Real-route check:** AC12 end-to-end run, plus the security matrix (non-member denial,
  injection cannot change identity, PKCE/redirect/CSRF failures, revocation).
- **Manual check:** final responsive, labeling, consent, and reception-state review.
- **Stop condition:** any acceptance criterion lacks observed evidence; the slice stays open.

## Dependencies between slices

`S1 → S2 → S3 → S4 → S5 → S6 → S7 → S8 → S9` is the intended order. S6 may start once S5's send
path commits inbox rows; S7 depends on S6 for pending-state truth. No slice may start before its
predecessor's checks pass, except S6 and S7 which may proceed together only under a single writer.

## Verification commands per slice

Each slice runs, at minimum, the subset of `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`,
`pnpm test:integration`, `pnpm test:contracts`, `pnpm build` that covers its files, plus its
real-route check. S9 runs `pnpm verify` and the combined E2E scenario.

## Structure outline gate

```markdown
Gate ID: outline-agent-chat-mvp-r1
Decision / allowed mutation: Approved by standing user statement approving all phases. Authorizes implementing slices S1-S9 in a dedicated worktree under the approved PRD, System Design, and Program Design, with strict TDD and one work-unit commit per slice.
Explicit exclusions: No push, pull request, merge, release, dependency beyond the approved Program Design list, product-scope expansion, or gate bypass for later revisions.
Owning artifact / revision or hash: .agent-workflow/tasks/agent-chat-mvp/05-structure-outline.md — revision 1
Decision owner: Product/technical owner (human)
Approved by / trusted identity: Ramiro, explicit user reply approving all phases
Approved at: 2026-10-14 22:38:11 UTC (standing approval; recorded once)
Status: approved
Invalidated by: Any change to slice scope, owning files, acceptance mapping, approved PRD behavior, approved System Design, or approved Program Design.
```

## Implementation target (resolved)

- Repository: `/Users/ramiro/Desktop/projects/agent_chat`
- Worktree: `/Users/ramiro/Desktop/projects/agent_chat.feat-agent-chat-mvp`
- Branch: `feat/agent-chat-mvp`, created with `wt switch --create`
- Decision: Ramiro, explicit user selection of the target project over the temporary bootstrap repository.
- The temporary bootstrap worktree is not an implementation target.

## Next step

Implement S1 in the worktree above with strict TDD, then commit it as the first work unit on
`feat/agent-chat-mvp`.
