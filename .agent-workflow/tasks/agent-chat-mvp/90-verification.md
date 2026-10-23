# Agent Chat MVP verification

Revision 2. Verified 2026-10-23, America/Sao_Paulo.
Controlling artifacts: PRD revision 2, System Design revision 2, Program Design
revision 1 and the approved structure outline.

## Checkout and runtime

Implementation branch: `feat/agent-chat-s7-s9`.
Worktree: `/Users/ramiro/Desktop/projects/agent_chat.feat-agent-chat-s7-s9`.
Source: `feat/agent-chat-mvp` at `238427eeef58df5ed933d013bbef527eff649924`.
Node.js 22.23.3, pnpm 11.10.0, Chromium through Playwright 1.63.0.

S1–S9 are complete for the local single-process MVP. The source checkout and the
primary checkout were preserved. No push, PR, merge, release or production
operation was performed.

## Automated evidence

`pnpm verify` passed the complete chain on this worktree:

| Layer | Result |
|---|---|
| ESLint | pass |
| TypeScript | pass |
| Unit | 148 passed |
| Contracts | 15 passed |
| Production build | pass |
| Integration | 117 passed; none skipped |
| Chromium E2E | 11 passed |

The combined full-loop test was run again after adding consent screenshots and
reviewing the mobile flow; it passed. The same full-loop test also passed against
a separately started HTTPS server behind Portless at
`https://agent-chat-s7-s9-review.localhost`. That run used an isolated SQLite file,
explicit loopback proxy trust, and the Portless CA for the Node clients.

The normal E2E harness uses its fixed local port to keep the OAuth issuer and
registered callback URLs stable. Interactive review servers were started through
Portless. No external dependency or unavailable E2E suite blocked validation.

## Acceptance evidence

| Criterion | Observed evidence |
|---|---|
| AC1: two-human realtime chat | `tests/e2e/chat.spec.ts`, two independent browser contexts |
| AC2: private membership | Browser refusal plus HTTP/MCP integration tests for non-member reads and writes |
| AC3: OAuth and identity reuse | Official MCP SDK OAuth client performs discovery, dynamic registration, S256 PKCE and code exchange; full-loop reconnect selects the same agent and creates no duplicate identity |
| AC4: agent-only authority | `tests/integration/security.test.ts`: bearer credentials cannot call owner APIs, and author fields/prompt text cannot change the authenticated identity |
| AC5: owner visible | Agent member row and messages inspected in browser screenshots; lifecycle E2E asserts both labels |
| AC6: scoped spontaneous send | MCP group authorization tests and full-loop first message from the agent before any incoming message |
| AC7: revocation | Lifecycle E2E revokes a connection and then an agent during live sessions; sockets close, MCP/refresh fail and historical authorship remains |
| AC8: idempotency | SQLite integration tests plus a full-loop SDK retry returning the same message ID with no extra message |
| AC9: active-runtime receipt | Separate real WebSocket client receives a persisted event; no automatic reply is generated |
| AC10: offline recovery | Full-loop closes receiver and MCP client, publishes through the browser, reauthorizes the same agent and retrieves the pending event |
| AC11: explicit acknowledgement | Reading history preserves pending state; repeated acknowledgement succeeds and the next inbox read excludes the event |
| AC12: combined route | `tests/e2e/full-loop.spec.ts`: real browser, production server, SQLite, SDK OAuth, MCP and receiver in one test |

## Security and failure checks

- Upgrade-time JWT checks cover expiry, issuer, audience, signature and agent binding.
  Token scopes are intersected with current connection scopes.
- Agent URL credentials and inbound application commands are rejected. Receiver
  limits, slot release, token-expiry closure and per-emission reauthorization pass.
- Cross-site browser WebSocket upgrades fail before the first private frame.
  Browser deliveries also recheck the human session and group membership.
- OAuth checks cover exact redirect matching, mandatory S256 PKCE, a wrong
  verifier, code replay and refusing another owner's identity.
- Owner HTTP mutations reject CSRF and cannot be authorized with an agent token.
- Connection/whole-agent revocation blocks reads, writes, inbox operations,
  refresh and receivers. Whole-agent revocation also rejects the earlier client's
  token after a second client has connected.
- Refresh rotation stores hashes, preserves consumed markers for reuse detection,
  and revokes the connection/family on reuse, including concurrent attempts.
  Agent refresh remains independent of the owner's browser session.
- Audit rows contain no credentials or message bodies. Injected audit failures
  roll back message/inbox creation or revocation and token invalidation together.
- Request limits distinguish unauthenticated IP, human session and agent connection
  budgets. An exhausted IP budget does not consume the authenticated budgets.
- Request logging removes query strings and redacts credential headers.

## Visual checks

Inspected generated browser screenshots for receiver state, owner labels,
revocation confirmation, consent creation/reuse and the 375-pixel mobile layout.
The mobile check caught horizontal overflow from a long client ID. Wrapping long
identifiers fixed it, and the full-loop browser assertion now passes.

Local screenshots, ignored by Git:

- `.local-state/s7-receiver.png`: connected receiver and visible owner.
- `.local-state/s8-revocation.png`: confirmation states that prior messages survive.
- `.local-state/s9-mobile.png`: group, owner controls and disconnected-receiver copy.
- `.local-state/s9-consent-new.png`: mobile creation consent and agent-only authority.
- `.local-state/s9-consent-reuse.png`: selection of the existing agent identity.

The T3 collaborative preview could navigate but its snapshot operation timed out
twice with `Preview automation snapshot timed out after 15000ms.` Visual review
used the real-route Playwright screenshots instead.

## Limits of the evidence

No production deployment, load test, multi-node test, accessibility audit or
browser matrix beyond Chromium was run. The backend and rate-limit state remain
single-process. Local signing keys are ephemeral unless `OIDC_JWKS_PATH` supplies
a persistent key file. External hosted runtimes and automatic replies remain
outside scope.

`oidc-provider` emits its known warning about Fastify's already-parsed body. The
SDK authorization, code exchange and refresh tests pass through that mounting.
The earlier Node 26 runtime warning was resolved by using the approved Node 22 LTS.

## Resumption

The completed worktree is retained. See `91-s7-s9-receipt.md` for slice commits and
execution evidence. No implementation slices remain open; publication and
integration into another branch are separate actions.
