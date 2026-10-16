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
| Integration | `pnpm test:integration` | pass — 84 tests, none skipped |
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

- **S4 is complete and verified.** The authorization-code exchange issues a JWT access token
  carrying `agent_id`, `connection_id`, and the resource audience; discovery, dynamic client
  registration, the consent screen, agent creation, immutable ownership, connection reuse,
  duplicate prevention, and cross-owner refusal are all covered. No S4 test is skipped.
- **S5–S9 are not started**, and each depends on the previous slice.
- No push, pull request, merge, or release was performed; those remain separate human decisions.

## S4 findings

Established by running the approved provider, not by reading its documentation. They are
recorded so the next session does not rediscover them.

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
   `better-sqlite3` also requires every named parameter to be present, so optional bookkeeping
   columns must be passed as `null`, not omitted.
4. `refresh_token` as a grant type is only enabled when the provider issues refresh tokens.
   Requiring `offline_access` would put a library default in front of a product decision, so the
   provider is configured to issue them and the product decision stands.
5. The same-origin guard originally applied to every mutation, which would reject every native
   MCP client that sends no `Origin`. It is now scoped to `/api/` and the consent form: those are
   browser-driven and need CSRF protection, while OAuth protocol endpoints authenticate through
   PKCE, a client identifier, and a single-use code.
6. Fastify parses request bodies before a handler runs, so the provider would read a drained
   stream. The provider's routes therefore live in an encapsulated scope whose content type
   parser passes the payload through untouched.

### Why the authorization code did not work

Recorded because each cause was observed, not inferred:

1. **Consent never resolved.** The grant recorded the agent scopes as resource scopes while
   resource indicators were disabled, so the provider considered consent unsatisfied and asked
   again after every approval. No code was issued at any point in that configuration. Recording
   them as OIDC scopes is what made the code appear.
2. **The token request arrived without a `content-type`.** The header had been moved inside the
   same condition as `Origin` when the same-origin guard was scoped to browser calls, so a native
   client's request body was never parsed and the provider reported
   `no client authentication mechanism provided`.
3. **The test read the code from the wrong response.** Approval redirects to the provider's own
   resume path, and only that next hop issues the code.
4. The access token stayed opaque: `accessTokenFormat` lives on a resource server, so JWT needs
   `resourceIndicators`, and with it enabled the consent policy asks two independent questions —
   scopes declared in the provider's scope list must be recorded as OIDC scopes, and the same
   scopes, offered by our resource server, must also be recorded as resource scopes for its
   indicator. Satisfying either alone re-prompts consent forever. The grant now records both.
5. Even then the token stayed opaque, because the resource granted at the authorization request
   is only applied to the issued token when `resourceIndicators.useGrantedResource` returns true
   (it defaults to false). Setting it is what makes the access token a JWT with agent claims.
6. Re-authorizing the same client added a connection row each time. A client now holds one
   connection, which is reused and has its scopes brought in line with what was consented.

Remaining S4 work: make the authorization-code exchange succeed through this mounting, make a
second consent round trip in one session work, re-enable the three skipped tests, and run an
E2E with a real OAuth-capable MCP client.

## Not-run checks and why

- No production deployment, load, or multi-node check: the approved design accepts single-node
  limits for the MVP.
- No migration rollback test: migrations are forward-only by decision.
- No accessibility or cross-browser matrix beyond Chromium.

## Next owner

Next action: implement S4 on Node 22 LTS, starting from the mounting findings above. Do not
begin S5 until S4 is verified, because the MCP tool surface depends on agent credentials.
