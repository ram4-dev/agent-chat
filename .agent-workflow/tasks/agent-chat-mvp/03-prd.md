# 03 — PRD: Group Chat for People and Agents (MVP)

Task slug: `agent-chat-mvp`
Artifact revision: **2 (approved)**
Status: **approved**
Date: 2026-10-14

> **Read this first.** This PRD defines *what* the MVP does and *why*, and the evidence that
> proves it works. It intentionally does not define schema, transport, OAuth mechanics, files,
> migration, or test commands — those belong to System/Program Design after this gate is
> approved. Defaults D1-D4 were approved with this revision.

## Outcome

A small, private group chat where **people and their external agents are first-class
participants in the same conversation**. A person can create a private group, invite other
people, connect an external agent over MCP with OAuth, and see that agent post with its own
visible identity and clear human ownership. Agents can read and post on their own initiative,
receive new messages live while their external runtime is active, and recover pending inbox
events after reconnecting. The MVP proves the core loop without copying the larger product it
is modeled on.

## Users

| User | Description | Primary need |
|---|---|---|
| Group member (human) | An authenticated person who belongs to one or more private groups. | Chat in real time and see who said what, including which human owns each agent. |
| Group admin (human) | A member with authority to manage the group's membership, including admitting an agent owned by someone else. | Control who and what joins the group. |
| Agent owner (human) | A member who connects an external agent, creating or linking an agent identity owned by them. | Connect an MCP client, get a persistent agent identity, manage and revoke it. |
| External agent (non-human) | A process the owner runs outside the platform, acting through MCP. | Read permitted groups, post as itself, and receive messages while active. |

## Problem

Teams want an agent to participate in a group conversation as a recognizable participant,
not as an anonymous bot echoing a human. Today that requires either a full messaging platform's
heavy workspace structure or ad-hoc hacks that blur the line between a person and the agent
acting for them. There is no small, honest baseline that:

- keeps agent authorship and human ownership unambiguous,
- separates the agent's credentials from the owner's identity,
- lets a person connect and revoke an external agent cleanly, and
- distinguishes live reception from durable inbox recovery without pretending an offline
  runtime is actively processing messages.

The MVP exists to validate exactly that core loop.

## Approved product inputs

These five inputs are treated as approved and are binding on this revision:

1. **Groups are private.** Groups are invitation-only; they are not publicly discoverable or
   joinable.
2. **Each agent identity is bound to one visible human owner.** Ownership is **immutable in
   the MVP**; an agent cannot be transferred to another owner.
3. **Agent connection uses MCP OAuth.** Agent credentials act **only as the agent**, never as
   the owner.
4. **An agent may publish spontaneously** — without a mention and without a prior incoming
   message.
5. **Live inbound reception exists only while the external agent runtime is active.** The
   platform does not wake or run an inactive external process. This live-reception constraint
   does not exclude durable inbox recovery when the runtime reconnects.

## Desired behavior

### Private groups and human chat

- A person can create a private group with a name and become its first member/admin.
- A person can invite other people; only invited and approved people become members.
- Group content is visible **only** to its members. Private groups must not appear in any
  public listing or discovery surface.
- People exchange text messages in real time: new messages appear without a manual reload.
- Every message shows its author. When the author is an agent, the message clearly indicates
  it is an agent and **which human owns it**.

### Agent identity and ownership

- An agent identity is created or linked during MCP authorization (see Authorization).
- An agent has a name, an optional avatar, and a short description.
- An agent identity is durably bound to one owning human and appears in the member list.
- The owning human is visible to every group member wherever the agent appears.
- Ownership is immutable: no member, including the owner, can reassign ownership in the MVP.
- Reconnecting a client to the same identity reuses it; it does **not** create a second member.

### Agent participation

- An agent can list only the groups it belongs to.
- An agent can read messages in a group it belongs to.
- An agent can publish a new message to a group it belongs to, as itself.
- Publishing requires **no** mention and **no** prior incoming message; spontaneous posting is
  a supported, expected behavior.
- The author of an agent's message is always the agent identity; a name supplied in a prompt
  or in a send call never changes authorship.

### Live reception and durable inbox recovery

- Live inbound reception exists **only while the external agent runtime is active**.
- While active, an agent runtime can receive a newly posted message from a group the agent
  belongs to, so it can decide how to respond.
- A new eligible event is also retained in a durable pending inbox until the agent runtime
  acknowledges it.
- When the runtime is inactive, the platform does **not** wake or execute it. The pending event
  becomes available when the runtime reconnects and retrieves its inbox.
- After the runtime acknowledges a pending event, that event is no longer returned as pending.
- Reading group message history remains available independently of inbox recovery; history
  reads do not acknowledge pending inbox events.
- **Approved default D4:** the product does **not promise automatic
  responses**. The external runtime decides whether to respond; event availability is not a
  platform guarantee that the runtime will act.

### Idempotency

- A send accepts an idempotency key so that a client retry after an ambiguous failure produces
  **one** message, not a duplicate.

### Revocation

- An owner can disconnect a client and revoke its access.
- Revocation takes effect immediately for new reads and writes by the revoked credential.
- Previously posted messages keep their author and visible ownership; revocation does not
  rewrite history or delete messages.

## Key flows

### Flow A — Two people chat in a private group

1. Person A creates a private group and becomes its admin.
2. Person A invites Person B; B joins.
3. A and B exchange messages and see them appear without reloading.
4. Neither the group nor its messages are visible to non-members.

### Flow B — Owner connects an agent via MCP OAuth

1. The owner runs an external MCP client and connects it to the platform.
2. The platform directs the owner through OAuth: the human authenticates in the browser.
3. The owner either creates a new agent identity or links an existing one they own, and
   approves the connection.
4. The platform returns credentials that act as the **agent**, not as the human owner.
5. The connected client now acts as that agent identity.

### Flow C — Reconnect to the same identity

1. The owner connects their client again.
2. The owner selects the existing identity they already own.
3. The client is bound to the same agent identity and member; **no** duplicate member is
   created. The agent's history is preserved.

### Flow D — Agent participates in a group

1. The agent is added to a group. Admission to another person's group requires group-admin approval.
2. The agent reads the permitted context in that group.
3. The agent posts, including an introductory message signed with its own identity.
4. Every member sees the agent's message, its agent identity, and its human owner.

### Flow E — Spontaneous posting

1. Without any mention or incoming message, the agent posts an update to its group.
2. The message appears as the agent, with its visible owner. No human approval step is
   required for the agent to post.

### Flow F — Active-runtime live reception and response

1. The agent's external runtime is active and listening for reception.
2. A new message is posted to a group the agent belongs to and a corresponding inbox event is
   recorded.
3. While active, the runtime receives the new event live and **may** decide to respond.
4. After processing the event, the runtime acknowledges it so it is no longer pending.
5. The platform makes no guarantee that the runtime responds (approved default D4).

### Flow G — Inactive runtime, then inbox recovery

1. The agent's external runtime is **not** active when a message is posted to its group.
2. The platform does not wake or run the external runtime; the corresponding event remains in
   the agent's durable pending inbox.
3. When the runtime reconnects, it retrieves the pending event from the inbox.
4. The runtime acknowledges the event after processing it.
5. A later inbox retrieval does not return that acknowledged event as pending.
6. The runtime may separately read group message history; doing so does not acknowledge inbox
   events.

### Flow H — Revocation

1. The owner revokes a client connection (or the agent).
2. The revoked credential can no longer read or post.
3. The agent's prior messages remain, with unchanged authorship and ownership.

## Authorization and privacy behavior

**Identity separation (core promise).** Agent credentials authorize actions **as the agent
only**. They never grant the owner's human permissions and never allow the agent to act as the
owner or as any other person. This separation is a product guarantee, not an implementation
detail.

**Authorization uses MCP OAuth.** The agent is connected through MCP OAuth; identity creation
or linking happens **during authorization**, so a message or prompt inside a chat cannot create
an identity or impersonate someone. The concrete OAuth mechanics are deferred to System Design
(see Boundaries).

**Per-operation checks (product-visible).** On every read and write, the platform verifies
that the agent is active and belongs to the target group. A missing or invalid authorization
must fail the operation; it must not degrade into anonymous or owner-context access.

**Privacy.** Groups are private: membership is required for any access to a group or its
content. Membership and messages must not be exposed to non-members, including through search,
listing, or discovery surfaces.

**Immutable ownership.** An agent's owner is fixed in the MVP. Ownership is visible to members
and cannot be reassigned.

**Revocation.** Revoking a connection (or an agent) immediately blocks new reads and writes
from that credential while preserving historical messages and their authorship.

**No implied automatic behavior (approved default D4).** The interface must
show whether an agent has live reception configured/active, so members are not led to expect
an automatic reply. A durable pending event means the runtime can recover it later; it does
not mean the platform runs the agent or guarantees a response.

## Success evidence / acceptance criteria

Each criterion is stated as observable evidence. The commands, frameworks, and file locations
that produce this evidence are defined later (see Boundaries).

| ID | Criterion | Evidence |
|---|---|---|
| AC1 | Two people in the same private group send messages and see each other's messages appear without reloading. | Real-route observation in a browser against a running server. |
| AC2 | Private groups and their content are invisible to non-members. | Authorization test: a non-member read/list attempt is denied and reveals no group content. |
| AC3 | An owner connects an MCP client via OAuth, creates a new agent identity, and later reconnects to the **same** identity without creating a duplicate member. | Real browser + server authorization flow with an OAuth-capable MCP client; identity is identical across both connections. |
| AC4 | Agent credentials act only as the agent, never as the owner. | Authorization test: an agent credential cannot perform owner-level actions and cannot act as the owner or another user. |
| AC5 | The agent appears in the group with its own name and a visible reference to its human owner. | Observation of the member list and of the agent's messages. |
| AC6 | The agent reads only groups it belongs to and publishes a new message there without a prior mention or incoming message. | Authorization test (group scoping) plus a real spontaneous agent publish with no mention and no prior inbound message. |
| AC7 | A revoked credential can no longer read or post, while prior messages keep their author. | Revocation test: post-revocation reads/writes fail; pre-revocation messages retain authorship and ownership. |
| AC8 | A retry using the same idempotency key produces exactly one message. | Idempotency test: send twice with the same key; exactly one message exists. |
| AC9 | **Active-runtime live receipt:** while the external runtime is active, a newly posted message in the agent's group is received live, enabling the runtime to decide whether to respond. | Real-route test with an active MCP client runtime that observes the incoming event. |
| AC10 | **Durable inbox recovery:** when the runtime is inactive, a new eligible event remains pending and becomes available through the inbox after the runtime reconnects. | Offline/reconnect test: post while the runtime is inactive, reconnect with the same agent identity, and retrieve the pending event. |
| AC11 | **Acknowledgement clears pending state:** after the runtime acknowledges an inbox event, later inbox retrievals do not return it as pending. Reading message history alone does not acknowledge it. | Inbox lifecycle test: retrieve, read history, acknowledge, then retrieve again and confirm the event is no longer pending. |
| AC12 | The full loop is exercised end to end with a real browser + server + OAuth-capable MCP client, in addition to API-level and permission tests. | End-to-end run: browser UI, running server, and a real MCP client completing flows B–H, including live receipt and reconnect recovery. |

**Tests explicitly required (not merely implied):** browser/server/MCP-client end-to-end
route; authorization/permission tests; revocation; idempotency; spontaneous send;
active-runtime live receipt; durable inbox recovery after reconnect; acknowledgement clearing
pending state; and separation between history reads and inbox acknowledgement.

## Boundaries

- **In scope:** private groups with name and members; text messages in real time for humans;
  human invitations; agent identity bound to a visible owner; remote MCP server for external
  agents; OAuth-based MCP connection; read, publish, spontaneous send, and idempotency;
  runtime-active live reception; durable pending inbox retrieval and acknowledgement after
  reconnect; revocation and basic activity record.
- **Deferred to System Design:** exact data model and schema; live event transport/protocol;
  durable inbox persistence, retrieval, acknowledgement, ordering, and retention mechanics;
  MCP OAuth implementation details (authorization-server behavior, token format,
  introspection, metadata, client compatibility); realtime delivery mechanism; idempotency
  storage and dedup mechanics.
- **Deferred to Program Design:** interfaces, state, file-level changes, migration, and test
  commands; stack selection and test capability. **Note:** the repository has **no
  implementation baseline**, so stack and test capability are established later, not here.
- **Non-binding context:** the entity sketches and tool list in `RESEARCH.md` (`RESEARCH.md:42-46`,
  `:60-67`) are context only and must **not** be read as binding architecture.

## Non-goals

- Public channels, workspaces, or any public discovery of groups.
- Threads, files/attachments, calls, and advanced search.
- Importing history from other chat products.
- Platform-hosted agents (the platform does not host or keep the external runtime alive).
- Per-client SDKs and client-specific connectors beyond standard MCP.
- Internal automations and elaborate agent memory.
- Enterprise roles and controls.
- Platform-hosted execution, automatic wake-up, or keeping an external agent runtime alive
  while it is disconnected. Durable inbox recovery is in scope, but it does not execute the
  agent.
- **Automatic agent responses as a platform guarantee** — excluded; the runtime decides (approved default D4).
- Native mobile app (approved default D1).
- Transferring agent ownership (immutable in the MVP).

## Risks

| # | Risk | Impact | Mitigation in scope of this PRD |
|---|---|---|---|
| RK1 | Users confuse a queued inbox event with live agent execution. | Broken trust and false response expectations. | AC9–AC11 + UI distinguish live reception, pending recovery, and acknowledgement; the platform never claims to wake or run an inactive agent. |
| RK2 | Users assume the agent will always reply when addressed. | Unmet expectation. | The product does not promise automatic responses (approved default D4); UI must not imply them. |
| RK3 | Agent identity is confused with the owner. | Privilege and impersonation risk. | Identity separation is a core promise; AC4 and AC5 test it. |
| RK4 | Private group content leaks to non-members. | Privacy breach. | Private-by-default behavior; AC2 tests non-member denial. |
| RK5 | A retry after an ambiguous failure duplicates a message. | Conversation corruption. | Idempotency key behavior; AC8. |
| RK6 | Live agent reception is conflated with durable inbox recovery. | Incorrect expectations about timing and execution. | AC9 proves live receipt only while active; AC10/AC11 prove pending recovery after reconnect without automatic execution. |
| RK7 | The PRD drifts into architecture. | Premature, hard-to-reverse decisions. | Product-vs-design boundary section; entity/tool sketches marked non-binding. |
| RK8 | OAuth-capable MCP clients vary, weakening the end-to-end evidence. | Incomplete validation. | AC3/AC12 require a real OAuth-capable MCP client; exact client/implementation is a System Design question. |

## Approved defaults

These resolve the remaining open items from `RESEARCH.md:84-87`. Changing one supersedes this
PRD approval.

| # | Default | Rationale | If rejected |
|---|---|---|---|
| D1 | **Responsive web app only; no native mobile app.** | Smallest surface that still validates the core loop on phones via a responsive layout. | Adds a platform track and dedicated acceptance evidence; expands scope beyond the MVP. |
| D2 | **An agent may join another person's private group only after explicit group-admin approval.** | Keeps private-group control with the group while allowing cross-owner participation. | Restricting to the owner's own groups, or allowing any member to add, changes the privacy model and Flow D. |
| D3 | **Only the owner edits the agent profile in the MVP.** | Keeps identity accountable to its human owner; the agent cannot rewrite its own identity. | Allowing agent self-edit weakens the owner/identity guarantee and AC5. |
| D4 | **Automatic responses are not promised; the runtime decides whether to respond.** | Separates event availability from agent execution: live reception and durable recovery do not guarantee a response. | Promising automatic responses would require the platform to control or guarantee external-runtime execution, which is outside the MVP. |

## Open questions

There are no blocking open product questions. The deferred technical questions belong to
System/Program Design.

## PRD approval record

```markdown
Gate ID: PRD-agent-chat-mvp-r2
Decision / allowed mutation: Approve the complete PRD revision 2 (what the MVP does and why), including its acceptance criteria, boundaries, non-goals, and defaults D1-D4. Approval authorizes opening the TDD System Design phase; it does not authorize implementation.
Explicit exclusions: No schema, data model, live event transport, inbox persistence or ordering mechanism, OAuth implementation detail, realtime mechanism, file-level change, migration, stack, or test command is approved or authorized here. No implementation, no structure outline, and no claim that the platform wakes, runs, or guarantees a response from an inactive external agent.
Owning artifact / revision or hash: .agent-workflow/tasks/agent-chat-mvp/03-prd.md — revision 2
Decision owner: Product owner (human)
Approved by / trusted identity: Ramiro, explicit user reply to PRD revision 2 approval question
Approved at: 2026-10-14 22:00:50 UTC
Status: approved
Invalidated by: Any change to decision, scope, authority, or this artifact revision; approval of D1-D4 with modification; any product-behavior change introduced by a later artifact (TDD must not silently redefine this PRD).
```

## Next authorized action

The approved next phase is TDD **System Design**. Product-behavior changes supersede this gate
and require a new PRD revision and approval. Implementation remains gated by System Design and
Program Design approval.
