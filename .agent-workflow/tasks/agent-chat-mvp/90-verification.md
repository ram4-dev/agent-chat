# 90 — Verification: Agent Chat MVP

Task slug: `agent-chat-mvp`
Artifact revision: **1**
Recorded: 2026-10-15
Controlling artifacts: `03-prd.md` r2 (approved), `04-tdd.md` System Design r2 + Program Design r1 (approved), `05-structure-outline.md` r1 (approved)

## Repository and branch

- Implementation repository: `/Users/ramiro/Desktop/projects/agent_chat`
- Implementation worktree: `/Users/ramiro/Desktop/projects/agent_chat.feat-agent-chat-mvp`
- Branch: `feat/agent-chat-mvp`
- Public remote: <https://github.com/ram4-dev/agent-chat>
- Runtime used for all recorded evidence: Node v26.8.1, pnpm 11.10.0

## Automated evidence

Run from the worktree root with `pnpm verify`, which chains lint, typecheck, unit, contract,
build, integration, and browser E2E.

| Layer | Command | Result |
|---|---|---|
| Lint | `pnpm lint` | pass |
| Types | `pnpm typecheck` | pass |
| Unit | `pnpm test:unit` | pass — 147 tests |
| Contract | `pnpm test:contracts` | pass — 15 tests |
| Integration | `pnpm test:integration` | pass — 79 tests |
| Build | `pnpm build` | pass |
| Browser E2E | `pnpm test:e2e` | pass — 8 tests in Chromium |

## Acceptance-criteria evidence

| Criterion | State | Evidence |
|---|---|---|
| AC1 | observed | `tests/e2e/chat.spec.ts` drives two real browser contexts; each sees the other's message over the live socket without reloading |
| AC2 | observed | `tests/e2e/groups.spec.ts` covers invite-and-join plus non-member refusal; integration tests prove the refusal is indistinguishable from an unknown group |
| AC3 | not started | requires S4 |
| AC4 | partial | agent credentials do not exist yet, so only the human side is proven |
| AC5 | partial | the member list renders an agent with its owner (`describeMember`), but no agent can be created yet |
| AC6 | not started | requires S5 |
| AC7 | not started | requires S8 |
| AC8 | observed | integration test asserts one message for a retried key and a conflict for a reused key with new content |
| AC9 | not started | requires S7 |
| AC10 | not started | requires S6 |
| AC11 | not started | requires S6 |
| AC12 | not started | requires S9 |

## Manual checks

| Check | State |
|---|---|
| Responsive layout of the group and chat surfaces | pending |
| Owner/agent labelling clarity in the member list | pending — no agent exists yet |
| Consent-screen copy states agent-only authority | pending — requires S4 |
| Reception state shown without implying automatic replies | pending — requires S7 |
| No implied automatic-response promise anywhere in the UI | pending |

## Defects found by checks rather than by reasoning

These are recorded because each one was a real failure observed while running the suite, not a
review comment.

1. **Repositories prepared statements before migrations ran.** The server crashed on first boot
   with `no such table: users`. Migrations now run before the application is composed, because
   wiring prepares statements eagerly.
2. **A bodyless POST carrying `content-type: application/json` is rejected by Fastify.** Inviting
   a member and removing a member both failed until the client stopped sending a content type
   with an empty body.
3. **Ordering by `(created_at, id)` is not a stable creation order.** Two messages written in the
   same millisecond tie on the timestamp, and a UUIDv7 breaks the tie by its random tail, so
   pagination could return an older message before a newer one. `0002_message_sequence` adds a
   per-group sequence allocated inside the same immediate transaction.
4. **A test helper named `join` shadowed `node:path`'s `join`**, which silently broke every
   temporary path in the harness.
5. **A delegated writer's test asserted a wrong UUIDv7 timestamp prefix.** The literal was
   corrected against the real encoding rather than the implementation being loosened.

## Blockers and not-run work

- **S4 is not started.** OAuth connection, agent identity, and consent remain unimplemented, so
  AC3, AC5 (complete), and AC4 cannot pass. No code was committed for S4.
- **S5–S9 are not started**, and each depends on the previous slice.
- No push, pull request, merge, or release was performed; those remain separate human decisions.

## S4 groundwork recorded before stopping

Two empirical findings were established by probing the approved provider in this runtime. They
are recorded so the next session does not rediscover them.

1. **The provider's callback cannot be mounted on a prefixed wildcard route.** With an issuer that
   includes a path, the provider expects its own absolute paths and answers `404` for every
   request. The correct mounting is `issuer` = origin with no path, and the provider's exact
   routes (`/.well-known/openid-configuration`, `/.well-known/oauth-authorization-server`,
   `/auth`, `/token`, `/reg`, `/jwks`, `/me`, `/revocation`, `/introspection`, `/session/end`)
   registered explicitly. Fastify has no Express-style `use`, so each route hijacks the reply and
   delegates to `provider.callback()` with the raw Node request and response.
2. **The provider warns that the runtime is unsupported.** It printed
   `Unsupported runtime. Use Node.js v22.x LTS, or a later LTS release` on Node v26.8.1. The
   approved Program Design pins Node.js 22 LTS, so this is a conformance signal rather than a
   defect: S4 must be developed and verified on Node 22 LTS, and the evidence above was produced
   on a runtime the provider does not support.
3. The adapter must be supplied as a **factory keyed by model name**, not as a single object.

Remaining S4 work: a SQLite-backed provider adapter, the exact-route mounting above, MCP
discovery forwarding at the root well-known paths, the consent screen that creates or links an
agent, the `agent_connections` row that becomes the revocation authority, agent access-token
claim injection for `agent_id` and `connection_id`, and an E2E run with a real OAuth-capable MCP
client.

## Not-run checks and why

- No production deployment, load, or multi-node check: the approved design accepts single-node
  limits for the MVP.
- No migration rollback test: migrations are forward-only by decision.
- No accessibility or cross-browser matrix beyond Chromium.

## Next owner

Next action: implement S4 on Node 22 LTS, starting from the mounting findings above. Do not
begin S5 until S4 is verified, because the MCP tool surface depends on agent credentials.
