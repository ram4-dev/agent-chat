# 04 — TDD: Agent Chat MVP

Task slug: `agent-chat-mvp`
System Design revision: **2 (approved)**
Program Design revision: **1 (approved)**
Phase: **Program Design**
Status: **approved**
Controlling PRD: `03-prd.md`, revision 2, approved 2026-10-14 22:00:50 UTC

> System Design revision 2 remains approved and unchanged. The Program Design appended below
> defines interfaces, state, physical persistence, file boundaries, migrations, and verification.
> It does not authorize implementation or a structure outline.

## Decision summary

| ID | Controlling decision |
|---|---|
| SD1 | Build a TypeScript modular monolith: one deployable application owns the web API, MCP endpoint, OAuth authorization server, realtime delivery, and background event dispatch. |
| SD2 | Use SQLite in WAL mode as the only required datastore for development, E2E, and the single-node MVP; require no hosted identity provider, queue, cache, database, or email service. |
| SD3 | Persist each message, send-idempotency record, and eligible agent inbox events atomically before attempting live delivery. |
| SD4 | Treat live delivery as an optimization over the durable inbox: active runtimes receive events immediately, while unacknowledged events remain recoverable after reconnect. |
| SD5 | Scope the inbox to the persistent agent identity, not one client connection; any valid connection for that agent can recover and acknowledge pending events. |
| SD6 | Use MCP OAuth Authorization Code with PKCE. Agent access tokens identify an agent and connection and never carry a human session or owner authority. |
| SD7 | Authorize every operation against current connection state, agent state, and group membership. Revocation and membership removal fail closed, including for live streams and pending-event reads. |
| SD8 | Guarantee at-least-once event availability until acknowledgement, not exactly-once agent execution or automatic response. |
| SD9 | Use MCP only for agent authorization, identity/context reads, sends, inbox recovery, and acknowledgement. Live agent reception uses a separate authenticated WebSocket opened by an opt-in external receiver that the owner runs; it is distinct from the browser WebSocket and cannot wake an inactive runtime. |
| SD10 | Accept single-node limits for the MVP; horizontal scale and a distributed broker require a later architecture revision. |

## Chosen stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 22 LTS + TypeScript | One language across browser, server, MCP, OAuth, and tests; mature local tooling. |
| Web client | React + Vite | Small responsive web surface with fast local startup and Playwright support. |
| Application server | Fastify | Explicit request lifecycle, schema validation, WebSocket support, and low ceremony for a modular monolith. |
| MCP | Official TypeScript MCP SDK over Streamable HTTP | Handles authorization, identity/context reads, sends, inbox recovery, and acknowledgement through a real MCP client; it is not the live-reception mechanism. |
| OAuth | In-process standards-compliant OAuth/OIDC provider library | Supports Authorization Code + PKCE, discovery metadata, short-lived access tokens, and refresh-token rotation without an external identity service. |
| Persistence | SQLite in WAL mode through a typed query layer | Transactions cover messages, idempotency, inbox events, OAuth grants, and audit records with no external database. |
| Browser realtime | Browser WebSocket hosted by the application server | Delivers chat updates to active browser sessions. |
| Agent live reception | Separate authenticated agent-receiver WebSocket hosted by the application server | Delivers committed events only while the owner's opt-in external receiver is running and connected. |
| Verification stack | Vitest for deterministic component/integration checks; Playwright, the official MCP client, and a test agent receiver over WebSocket for E2E | Covers browser, server, OAuth, MCP tools, active receiver events, reconnect recovery, and permission boundaries locally. |

The production process serves the built web client and all server surfaces from one origin. Local
and E2E environments run the same components against isolated SQLite databases. Invitations are
represented by application-generated links/tokens; sending email is not required.

## Architecture and components

```text
Browser ── HTTPS + browser WebSocket ────────────────┐
MCP client ── OAuth + MCP Streamable HTTP (tools) ───┤
Owner-run agent receiver ── authenticated WebSocket ─┤
                                                     ▼
                                                Application
                                                ├─ Human web/API adapter
                                                ├─ MCP tool adapter
                                                ├─ Agent receiver gateway
                                                ├─ OAuth authorization server
                                                ├─ Identity and membership service
                                                ├─ Messaging service
                                                ├─ Inbox service
                                                ├─ Live delivery hub
                                                └─ SQLite transaction store
```

- **Human web/API adapter:** browser sessions, private groups, invitations, membership, profiles,
  messages, and owner/admin actions.
- **MCP tool adapter:** identity lookup, permitted-group listing, message reads, spontaneous sends,
  pending-inbox reads, and acknowledgements. MCP does not own live agent reception.
- **Agent receiver gateway:** accepts a separate authenticated WebSocket from an opt-in external
  receiver run by the owner. It delivers events only while that receiver process is connected;
  it does not start, wake, host, or control the runtime.
- **OAuth authorization server:** browser login and consent, create-or-link agent selection,
  client registration metadata, authorization codes, agent access tokens, refresh-token
  rotation, discovery metadata, and revocation.
- **Identity and membership service:** separates human, agent, owner, connection, and group-admin
  authority. Agent ownership is immutable.
- **Messaging service:** validates membership, assigns effective authorship, applies send
  idempotency, and commits messages with recipient events.
- **Inbox service:** exposes agent-scoped pending events with stable ordering and idempotent
  acknowledgement.
- **Live delivery hub:** publishes committed messages to connected browser WebSockets and
  committed events to authenticated agent-receiver WebSockets. It is not authoritative storage.
- **SQLite transaction store:** source of truth for identity, membership, messages, OAuth grants,
  idempotency, inbox state, and bounded security audit records.

## Logical state boundaries

This is a logical model, not a physical schema.

- **Human identity and session** authenticate browser actions.
- **Agent identity** has one immutable owner and a mutable profile controlled only by that owner.
- **Agent connection** represents one OAuth grant/client relationship and can be revoked without
  deleting the agent.
- **Private group membership** records human members, agent members, and group-admin authority.
- **Message** records the effective author, group, content, and server-assigned ordering.
- **Send idempotency record** binds an author, key, and request digest to one message result.
- **Inbox event** belongs to an agent identity, references the committed message/event, has a
  stable agent-local sequence, and transitions from pending to acknowledged.
- **Audit record** captures security-relevant actions such as authorization, group admission,
  revocation, and denied access without storing credentials.

Acknowledged inbox events remain distinguishable from pending events; exact retention and
physical indexes belong to Program Design. No automatic deletion may remove an unacknowledged
MVP event.

## Message and event flow

### Human or agent sends a message

1. Resolve the caller as exactly one principal: human session or agent connection.
2. Verify the principal is active and is currently a member of the target private group.
3. For an agent send, derive authorship from the access token; ignore any caller-supplied author.
4. In one SQLite transaction:
   - claim or validate the send idempotency key,
   - append the message,
   - append one durable inbox event for each eligible agent recipient, and
   - append the required audit metadata.
5. Commit before publishing anything live.
6. Notify connected browser sessions and connected agent-receiver WebSockets from committed
   state.
7. If live notification fails, no receiver is connected, or the process stops after commit, the
   inbox event remains pending and is recovered through MCP after reconnect.

A repeated send with the same author, key, and request digest returns the original message. The
same key with a different digest fails as a conflict.

### Active external receiver gets an event

1. The owner explicitly runs an external receiver and opens the dedicated agent WebSocket using
   an OAuth-issued agent credential bound to its connection and agent identity.
2. The receiver gateway authenticates the handshake and rechecks connection, agent, and current
   group membership before each emission.
3. The live delivery hub emits only committed events while that WebSocket is connected.
4. Live delivery does not clear pending state and does not imply an automatic response.
5. The runtime acknowledges processed events through the MCP inbox tool; acknowledgement is
   idempotent.

If the receiver is not running, nothing attempts to wake or reactivate it. The event remains in
its durable inbox.

### Inactive runtime reconnects through MCP

1. OAuth refresh or reauthorization yields a valid connection for the same agent identity.
2. The MCP client requests pending inbox events using a stable cursor and bounded page size.
3. The server rechecks current agent state and group membership before returning each event.
4. The MCP client acknowledges processed events. Later reads omit acknowledged events.
5. Reading message history does not acknowledge inbox events.

## MCP OAuth and permission model

- Use OAuth Authorization Code with PKCE for public MCP clients; require exact redirect-URI
  matching, `state`, short-lived authorization codes, and one-time code redemption.
- Publish protected-resource and authorization-server metadata required for MCP discovery.
- The human authenticates in the browser with a local application account, then explicitly
  creates or selects an agent they own and grants one client connection.
- Access tokens are short-lived and audience-bound to the MCP resource. They identify
  `agent_id` and `connection_id`; they do not contain or imply a human session.
- Refresh tokens are rotating, stored only as hashes server-side, and invalidated on reuse or
  connection revocation.
- Signature, issuer, audience, expiry, connection status, agent status, and current membership
  are checked on every protected operation. A valid signature alone is insufficient.
- Group-admin approval is required before an agent owned by another person becomes a member.
- Revoking one connection closes its MCP access and any agent-receiver WebSocket authenticated
  by that connection, and blocks future calls without deleting the agent or its inbox. Revoking
  the agent blocks all connections.
- Removing the agent from a group immediately blocks message/history reads and suppresses any
  pending event whose content is no longer authorized.

## Consistency and failure behavior

| Failure | Required behavior |
|---|---|
| Message transaction fails | No message, idempotency claim, or inbox event becomes visible. |
| Process stops after commit but before live publish | Message and inbox events survive; active delivery may be missed, but reconnect recovery works. |
| Browser or agent-receiver WebSocket drops | Stop live delivery to that socket; agent events remain pending and recoverable through MCP. |
| Event is delivered more than once before acknowledgement | Preserve one event identity; acknowledgement remains idempotent. Consumers must tolerate at-least-once delivery. |
| Acknowledgement fails or times out | Event stays pending; retry is safe. |
| Same send key is retried | Return the original result for the same digest; reject a different digest. |
| OAuth callback, code, redirect, or PKCE check fails | Create no agent connection or token; show a generic failure and audit the denial. |
| Connection or agent is revoked | Reject new calls, close active delivery, reject refresh, and preserve historical authorship. |
| Membership changes while an event is pending | Reauthorize on inbox read; do not disclose content the agent can no longer access. |
| SQLite is unavailable or locked beyond the bounded retry policy | Fail closed; do not acknowledge writes or invent a successful send. |

## Security boundaries

- Browser input, MCP arguments, message content, prompts, event payloads, redirect URIs, cursors,
  and client metadata are untrusted.
- Authorization decisions use server-owned identity and membership state, never names or claims
  supplied inside prompts/messages.
- Human browser sessions use secure, HTTP-only, same-site cookies and CSRF protection. Agent
  credentials are never placed in browser storage or URL query strings. The agent-receiver
  WebSocket authenticates during its handshake, not through a token in the URL.
- Non-local deployments require TLS. Logs and audit records must exclude access tokens, refresh
  tokens, authorization codes, session cookies, and full message bodies.
- Render message content as escaped text in the MVP; no arbitrary HTML or executable content.
- Apply bounded message size, inbox page size, connection count, and per-principal request rate.
  Exact limits belong to Program Design.
- Store signing keys and production secrets outside the database and repository. Development and
  E2E use generated local keys; no third-party secret service is required.
- The live delivery hub cannot authorize access. The browser and agent receiver gateways remain
  separate trust boundaries; the receiver gateway rechecks active connection and membership
  state before each emission.
- Prompt injection cannot create/link identities, change ownership, admit an agent, grant OAuth
  consent, or widen group access; those actions require authenticated human UI flows.

## Development and E2E topology

A developer or CI job starts one application process and one temporary SQLite database. The
process hosts the web app, API, OAuth endpoints, MCP Streamable HTTP tool endpoint, separate
browser and agent-receiver WebSocket gateways, and event dispatcher. E2E uses:

1. a real browser for human login, consent, groups, and messages;
2. the running application server and SQLite database;
3. a real OAuth-capable MCP SDK client for authorization, context reads, spontaneous send,
   inbox recovery, and acknowledgement;
4. a separate owner-run test receiver connected through the authenticated agent WebSocket to
   prove active-runtime live receipt;
5. a disconnected-receiver case proving that no process is awakened and that durable recovery
   still works through MCP after reconnect;
6. a no-auto-response assertion: receiving an event does not produce a message unless the test
   runtime explicitly sends one; and
7. authorization, revocation, idempotency, and spontaneous-send checks.

No Docker service, hosted IdP, SMTP server, Redis, message broker, or external database is
required. Containers may be added later for reproducibility, but they are not an architectural
dependency.

## Accepted limits and tradeoffs

- SQLite and an in-process delivery hub keep the MVP reproducible but limit it to one active
  application node. A multi-node deployment requires Postgres-compatible persistence and a
  shared event broker in a separately approved design.
- At-least-once event availability is honest and recoverable; exactly-once external agent
  execution is impossible to guarantee across network/process failures.
- MCP tool access does not imply that a host is running or processing unsolicited events. Live
  reception therefore requires the owner's opt-in external receiver and its authenticated
  WebSocket; the platform neither hosts nor wakes it.
- Keeping OAuth in-process removes a mandatory external service but increases the application's
  security responsibility; standards libraries and protocol-level E2E are mandatory.
- One deployable modular monolith minimizes distributed failure modes. Component boundaries must
  remain explicit so persistence or transport can be replaced later without changing approved
  product behavior.

## Protocol evidence

The current MCP subscription stream is opened by the client and covers declared tool, prompt,
and resource change notifications. It does not start or wake a stopped host/runtime, and it
does not define chat-message delivery. Therefore MCP remains the tool and inbox surface, while
live agent reception is a separate owner-operated WebSocket connection.

Source: <https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28>

## Questions and approval scope

There are no unresolved System Design questions beyond approval of SD1–SD10 as a coherent
architecture. Rejecting or changing a controlling decision requires revision 3 of this System
Design. Any change to approved product behavior requires reopening the PRD instead.

At System Design approval, Program Design had not started. The Program Design section below
now defines interfaces, physical state, migrations, and verification; implementation and the
structure outline remain excluded until their own gates.

## System Design approval record

```markdown
Gate ID: TDD-system-agent-chat-mvp-r2
Decision / allowed mutation: Approve System Design revision 2 and controlling decisions SD1-SD10, including the separate authenticated agent-receiver WebSocket in SD9. Approval authorizes drafting TDD Program Design only; it does not authorize implementation, a structure outline, staging, or delivery.
Explicit exclusions: No Program Design, endpoint or tool signature, physical schema, migration, module/file layout, package version, test command, implementation task, source code, structure outline, delivery action, hosted agent runtime, runtime wake mechanism, or automatic response guarantee is approved here.
Owning artifact / revision or hash: .agent-workflow/tasks/agent-chat-mvp/04-tdd.md — System Design revision 2
Decision owner: Product/technical owner (human)
Approved by / trusted identity: Ramiro, explicit user reply approving System Design revision 2
Approved at: 2026-10-14 22:23:18 UTC
Status: approved
Invalidated by: Any change to SD1-SD10, architecture scope, security boundary, failure boundary, controlling PRD behavior, or this artifact revision.
```

## System Design result

System Design revision 2 is approved. That approval authorized the Program Design below; it did
not authorize implementation.

---

# Program Design

Program Design revision: **1 (approved)**
Status: **approved**

## Controlling decisions

| ID | Program decision |
|---|---|
| PD1 | Use a pnpm workspace with `apps/web`, `apps/server`, and `packages/contracts`; the server remains the single deployable backend and serves the built web app. |
| PD2 | Use Fastify, `@fastify/websocket`, Zod-based request schemas, Drizzle ORM, and `better-sqlite3`; pin compatible stable versions in the lockfile. |
| PD3 | Use `oidc-provider` for the in-process OAuth/OIDC authorization server and the official `@modelcontextprotocol/sdk` for MCP Streamable HTTP. Do not hand-roll either protocol. |
| PD4 | Keep browser HTTP/WebSocket, MCP tools, and the agent-receiver WebSocket as separate adapters over shared application services and authorization policies. |
| PD5 | Use opaque UUIDv7 identifiers externally. Use database constraints plus application policies to enforce immutable ownership, private membership, idempotency, and inbox uniqueness. |
| PD6 | Commit messages, send-idempotency state, recipient inbox events, and audit metadata in one SQLite write transaction. Publish live events only after commit. |
| PD7 | Keep inbox events agent-scoped, ordered by an agent-local sequence, pending until explicit MCP acknowledgement, and reauthorized at read/delivery time. |
| PD8 | Authenticate the agent-receiver WebSocket with the OAuth agent credential during the HTTP upgrade; never accept bearer tokens in a URL. The socket is server-to-client events plus protocol ping/pong only. |
| PD9 | Use short-lived JWT access tokens and rotating opaque refresh tokens stored as hashes. Every protected request/socket validates token claims and current database state. |
| PD10 | Establish strict TDD for implementation with Vitest, temporary SQLite integration tests, Playwright browser E2E, a real MCP SDK client, and a real agent-receiver WebSocket client. |
| PD11 | Use numbered forward-only SQLite migrations. The greenfield initial migration creates the complete MVP schema; no existing production-data migration is required. |
| PD12 | Keep all limits and error contracts centralized in shared contracts so HTTP, MCP, WebSocket, tests, and UI cannot silently diverge. |

## Package and module boundaries

```text
apps/
  server/
    src/
      main.ts
      config/
      adapters/http/
      adapters/browser-ws/
      adapters/agent-ws/
      adapters/mcp/
      adapters/oauth/
      modules/auth/
      modules/identity/
      modules/groups/
      modules/messaging/
      modules/inbox/
      modules/audit/
      persistence/
      realtime/
  web/
    src/
      app/
      features/auth/
      features/groups/
      features/chat/
      features/agents/
      shared/
packages/
  contracts/
    src/http/
    src/mcp/
    src/websocket/
    src/domain/
db/
  migrations/
tests/
  integration/
  contracts/
  e2e/
```

- Adapters translate transport input into application commands and queries; they do not contain
  authorization or persistence rules.
- Modules own use cases and policies. They depend on repository and clock/token interfaces, not
  Fastify, MCP, WebSocket, or SQLite concrete types.
- Persistence implements repositories and transactions for the modules.
- `packages/contracts` contains transport schemas, public error codes, cursor envelopes, event
  envelopes, and configured limits. It contains no secrets or database models.
- The web app consumes HTTP/browser-WebSocket contracts only. It never imports server modules.

## Planned dependencies

| Concern | Package choice |
|---|---|
| HTTP server | `fastify`, `@fastify/cookie`, `@fastify/csrf-protection`, `@fastify/rate-limit` |
| WebSockets | `@fastify/websocket` with the `ws` implementation |
| Validation/contracts | `zod`, `fastify-type-provider-zod` |
| Persistence | `drizzle-orm`, `drizzle-kit`, `better-sqlite3` |
| OAuth/OIDC | `oidc-provider`, `jose` |
| Password hashing | `argon2` using Argon2id |
| MCP | `@modelcontextprotocol/sdk` |
| Web | `react`, `react-dom`, `vite`, `@tanstack/react-query` |
| Unit/integration | `vitest` |
| Browser E2E | `@playwright/test` |

Exact compatible versions are selected once at bootstrap and frozen by `pnpm-lock.yaml`; changing
protocol, persistence, or security libraries later requires compatibility evidence but not a new
product decision unless behavior changes.

## External interfaces

### Human HTTP API

All `/api/*` routes require a human session except registration/login/invitation acceptance.
Bodies and responses use shared Zod contracts.

| Area | Operations |
|---|---|
| Session | register, login, logout, current user |
| Groups | create, list memberships, read one private group |
| Invitations | create invite token, inspect/accept valid invite |
| Membership | list members, admit/remove human, admit/remove agent; admin-only mutations |
| Messages | cursor-based read; human send |
| Agents | create profile, list owned agents, edit owned profile, list/revoke connections, revoke agent |
| OAuth consent | select existing owned agent or create one; approve/deny the requesting client |

HTTP mutations use CSRF protection for cookie-authenticated sessions. Authorization failures use
`404` when revealing resource existence would leak private membership; otherwise `401` or `403`
as appropriate.

### Browser WebSocket

Endpoint: `/ws/browser` using the existing secure human session cookie and an origin check.

Server events:

- `message.created`
- `group.membership.changed`
- `agent.connection.changed`

The client subscribes only to groups returned by the authenticated session. Message catch-up
always uses HTTP cursor reads; the socket is not durable storage.

### MCP Streamable HTTP

Endpoint: `/mcp`; bearer token audience must identify this protected resource.

| Tool | Required input | Result |
|---|---|---|
| `get_identity` | none | agent, visible owner summary, connection state |
| `list_groups` | optional cursor, limit | current agent memberships only |
| `read_messages` | `group_id`, optional cursor, limit | authorized ordered message page |
| `send_message` | `group_id`, text content, idempotency key | one canonical message result |
| `get_inbox` | optional sequence cursor, limit | currently authorized pending event page |
| `ack_inbox` | `event_id` | idempotent acknowledged result |

MCP errors return stable codes (`unauthenticated`, `forbidden`, `not_found`, `conflict`,
`invalid_input`, `rate_limited`, `temporarily_unavailable`) without stack traces or private
resource details.

### Agent-receiver WebSocket

Endpoint: `/ws/agent`. The owner-run receiver sends `Authorization: Bearer <agent access token>`
in the HTTP upgrade. Query-string credentials are rejected.

After authentication the server sends:

```text
receiver.ready { agent_id, connection_id }
inbox.event    { event_id, sequence, group_id, message, created_at }
```

The message envelope includes effective author type/id, display name, visible owner summary for
agent authors, text content, and server timestamp. The receiver sends no chat commands on this
socket; it uses MCP to read context, send, retrieve inbox events, and acknowledge. Transport
ping/pong is permitted. Closing the receiver never clears pending inbox state.

## Physical persistence

SQLite enables `foreign_keys`, WAL mode, a bounded busy timeout, and transactions using
`BEGIN IMMEDIATE` for write paths that allocate idempotency or inbox sequence state.

| Table | Key fields and constraints |
|---|---|
| `users` | id, normalized email unique, password hash, display name, created timestamp |
| `human_sessions` | hashed session id, user id, expiry, revoked timestamp |
| `agents` | id, immutable owner user id, name, avatar URL nullable, description, active/revoked state |
| `agent_connections` | id, agent id, OAuth client id, granted scopes, created/revoked timestamps |
| `groups` | id, name, creator user id, created timestamp |
| `group_human_memberships` | group id + user id unique, role (`admin` or `member`) |
| `group_agent_memberships` | group id + agent id unique, admitted-by admin user id |
| `invitations` | hashed token, group id, inviter user id, expiry, accepted-by/at nullable |
| `messages` | id, group id, author kind, human author id nullable, agent author id nullable, text, created timestamp; exactly one author id set |
| `message_idempotency` | author kind/id + key unique, request digest, message id, created timestamp |
| `inbox_events` | id, agent id, agent-local sequence unique, group id, message id, created timestamp, acknowledged timestamp nullable |
| `oauth_clients` | client id, redirect URIs, public-client metadata, registration timestamp |
| `oauth_grants` | grant/authorization-code state required by the provider, agent/connection binding, expiry/consumed state |
| `oauth_refresh_tokens` | token hash unique, connection id, expiry, rotated/revoked state |
| `audit_events` | actor kind/id, action, target kind/id, outcome, timestamp, bounded metadata |

Required invariants:

- `agents.owner_user_id` cannot change after insert; repository update APIs omit it and a SQLite
  trigger rejects direct updates.
- A group must retain at least one human admin; removing the last admin fails.
- Agent admission requires the acting user to be a current group admin.
- Message authorship is derived from the authenticated principal and enforced by a check
  constraint plus foreign keys.
- `(author, idempotency_key)` maps to one request digest and one message.
- `(agent_id, message_id)` creates at most one inbox event for that event type.
- `(agent_id, sequence)` is unique and monotonically allocated inside the message transaction.
- Inbox queries join current agent/group membership; stale pending rows never disclose removed
  group content.
- Acknowledgement sets `acknowledged_at` once and succeeds idempotently thereafter.

## Transaction procedures

### Send message

1. Validate text (UTF-8, non-empty, maximum 8 KiB) and idempotency key.
2. Begin an immediate write transaction and reauthorize the caller.
3. Claim `(author, key)` with a digest of normalized inputs.
4. If the same digest already has a result, return it; if the digest differs, return `conflict`.
5. Insert the message and eligible agent inbox rows with allocated sequences.
6. Insert bounded audit metadata and commit.
7. Publish message and inbox identifiers to the in-process live hub after commit.

### Read/acknowledge inbox

- `get_inbox` returns at most 100 pending rows ordered by sequence, after current-state
  authorization of every row.
- `ack_inbox` verifies that the authenticated agent owns the event and can still access its group,
  then sets `acknowledged_at`. A repeated acknowledgement returns success.
- Unauthorized stale rows remain undisclosed. A maintenance path may tombstone them later; no
  automatic cleanup is part of the MVP.

### Live agent delivery

- Upgrade authentication validates token signature, issuer, audience, expiry, connection, agent,
  and `agent:receive` scope before accepting the socket.
- Each emission rechecks connection/agent state and group membership.
- Revocation closes matching sockets. Delivery failure changes no durable state.
- The event remains pending until MCP acknowledgement, whether or not it was delivered live.

## OAuth and session details

- Human passwords use Argon2id. Human sessions are opaque, server-stored, HTTP-only, secure in
  non-local environments, same-site lax, and expire after 8 hours of inactivity.
- OAuth supports Authorization Code + PKCE (`S256`) for public clients, protected-resource and
  authorization-server metadata, exact redirect matching, state validation, and dynamic client
  registration compatible with the selected MCP client.
- Consent binds one human owner, one selected/created agent, one OAuth client, one connection,
  and explicit scopes: `agent:read`, `agent:send`, `agent:inbox`, `agent:receive`.
- Access tokens are JWTs signed with EdDSA, audience-bound, and expire after 10 minutes.
- Refresh tokens are opaque, random, single-use rotating values with a 30-day maximum lifetime;
  only hashes are stored.
- Refresh-token reuse revokes that token family and the associated connection.
- Development/E2E signing keys are generated into an ignored local state directory. Production
  keys are supplied through an external file or process environment and are never committed.

## Limits and error behavior

| Limit | MVP value |
|---|---|
| Message text | 8 KiB UTF-8 |
| Read/inbox page | default 50, maximum 100 |
| Browser sockets | maximum 5 per human session |
| Agent receiver sockets | maximum 2 per agent connection |
| WebSocket frame | maximum 64 KiB |
| OAuth authorization code | 5-minute expiry, single use |
| Access token | 10-minute expiry |
| Refresh token family | 30-day maximum lifetime |

Rate limits are keyed separately for unauthenticated IPs, human sessions, and agent connections.
Exceeded limits return stable errors and do not partially write state.

## Migrations and local data

- `0001_initial_mvp` creates all domain, OAuth, inbox, and audit tables, constraints, indexes, and
  the immutable-owner trigger.
- Migrations run before the server accepts traffic and execute in a transaction when SQLite
  permits it. A failed migration prevents startup.
- Migration files are immutable after merge; corrections use a new numbered migration.
- Local development and E2E use separate database files. E2E creates a fresh temporary database
  per worker and applies the same migrations used by the application.
- Seed data is optional and development-only. E2E creates users, groups, agents, and OAuth clients
  through public interfaces or explicit test fixtures, never production seed paths.
- There is no legacy-data import or downgrade migration in the MVP.

## Verification plan

Strict TDD is active for implementation: each behavior begins with an observed failing test, then
the smallest passing change, then refactoring with focused checks.

Planned commands:

```text
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:contracts
pnpm test:e2e
pnpm build
pnpm verify
```

| Layer | Required evidence |
|---|---|
| Unit | authorization policies, immutable ownership, idempotency digest behavior, cursor/limit validation, scope checks |
| Integration | SQLite constraints/transactions, migrations, OAuth code/refresh/revocation, MCP tool results/errors, browser and agent WebSocket authentication |
| Contract | shared Zod schemas against HTTP, MCP, and both WebSocket adapters; stable public error codes |
| E2E | real browser + server + SQLite + OAuth-capable MCP SDK client + separate agent-receiver WebSocket client |
| Security | non-member denial without leakage, prompt cannot change identity, redirect/PKCE/CSRF failures, revocation closes access/sockets, logs contain no credentials |
| Build/static | lint, typecheck, production web/server build, migration validation |

Acceptance mapping:

- AC1–AC2: browser E2E for private realtime chat and non-member denial.
- AC3–AC5: browser + MCP OAuth E2E for identity reuse, authority separation, and visible owner.
- AC6: MCP contract/E2E for scoped reads and spontaneous send.
- AC7: integration/E2E for connection and agent revocation with preserved authorship.
- AC8: concurrent integration test for idempotent send and conflict digest.
- AC9: separate authenticated agent-receiver WebSocket E2E; no message appears automatically.
- AC10–AC11: disconnect receiver, publish, reconnect through MCP, retrieve, read history without
  acknowledgement, acknowledge, then verify the event is absent from pending results.
- AC12: one full real-route E2E combining browser, server, SQLite, OAuth, MCP, and agent receiver.

Manual checks remain required for responsive layout, owner/agent labeling clarity, consent copy,
reception-state clarity, and the absence of an implied automatic-response promise.

## Program Design questions and scope

There are no unresolved Program Design questions beyond approval of PD1–PD12 as one coherent
plan. Changing approved product behavior reopens the PRD; changing SD1–SD10 reopens System
Design. Package patch/minor updates that preserve contracts and pass verification do not reopen a
design gate.

Approval of this Program Design authorized the structure outline only. Source code, migrations, task
breakdown, staging, commit, and delivery actions remain excluded until the structure outline is
approved and each slice is implemented under it.

## Program Design approval record

```markdown
Gate ID: TDD-program-agent-chat-mvp-r1
Decision / allowed mutation: Approve Program Design revision 1 and controlling decisions PD1-PD12. Approval authorizes drafting the structure outline only; it does not authorize implementation, source changes, migrations, staging, commit, or delivery.
Explicit exclusions: No source code, generated project, installed dependency, database migration execution, structure outline, implementation task, staging, commit, push, pull request, or release is approved here.
Owning artifact / revision or hash: .agent-workflow/tasks/agent-chat-mvp/04-tdd.md — Program Design revision 1
Decision owner: Product/technical owner (human)
Approved by / trusted identity: Ramiro, explicit user reply approving Program Design revision 1
Approved at: 2026-10-14 22:38:11 UTC
Status: approved
Invalidated by: Any change to PD1-PD12, interface contract, physical state model, migration plan, verification plan, approved PRD behavior, approved System Design, or this Program Design revision.
```

## Next authorized action

Program Design revision 1 is approved. The next authorized artifact is the structure outline
(`05-structure-outline.md`), which the user has authorized drafting and which remains the
explicit review point before implementation. Passing that review authorizes implementation of
the approved vertical slices only; it does not authorize push, pull request, merge, or release,
which remain separate human decisions.
