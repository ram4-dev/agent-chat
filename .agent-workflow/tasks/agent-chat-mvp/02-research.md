# 02 — Research

Task slug: `agent-chat-mvp`
Artifact revision: 1 (draft)

## Current state (repository)

The repository has **no implementation baseline**. It contains research and agent-workflow
artifacts only:

- `RESEARCH.md` — the sole substantive product source, a Spanish-language research note
  ("propuesta para discutir antes de implementar") dated 2026-10-14.
- `AGENTS.md` — the orchestration rule requiring a HumanLayer workflow before any
  development.
- `.agent-workflow/tasks/agent-chat-mvp/herdr-session.md` — a prior session receipt
  (`status: running`) recording an implementation assignment that this PRD gate supersedes.
- `.agents/skills/**` — installed workflow skills.

Evidence: `RESEARCH.md:91` states the repository was empty at research start and no prior
implementation conditions the decisions; `git log` shows only two commits, `751d3e7` ("Add
initial agent chat research") and `c83efac` (commit subject "Record blocked Herdr
implementation session", whose receipt reports `status: running`). `git status`
shows no tracked source files: untracked workflow/skill and index directories, `AGENTS.md`,
plus a modified `herdr-session.md`, all pre-existing or from an earlier session.

**Consequence for planning:** there is no code, schema, test suite, build, or stack to
inspect. Product behavior must be defined without reference to an existing system, and all
verification commands are unknown until an implementation baseline exists. Stack selection
and test capability therefore belong to a **later** gate, not this one.

## Sourced facts (product intent and boundaries)

| Fact | Source |
|---|---|
| The MVP is deliberately smaller than Ando: private groups, full human chat, external agent connection from day one. | `RESEARCH.md:11` |
| A person creates a group, invites people, and adds their agents. | `RESEARCH.md:15, 23-28` |
| Each agent has name, optional avatar, short description, and a visible human owner. | `RESEARCH.md:15` |
| People and agents share one conversation; authorship and agent ownership are shown clearly. | `RESEARCH.md:15-19` |
| Agent identity is created or linked during MCP authorization; the owner logs in and approves. | `RESEARCH.md:17, 25, 48-54` |
| Reconnecting a client to the same identity does not create another member. | `RESEARCH.md:17, 48-54` |
| The owner can rename, manage groups, disconnect a client, and revoke access. | `RESEARCH.md:17` |
| `send_message` requires neither a mention nor a prior message. | `RESEARCH.md:19, 65` |
| Agent credentials authorize actions **as the agent**, never as the owner; the author is not changed by a claimed name. | `RESEARCH.md:46, 52` |
| The server verifies on each read/write that the agent is active and belongs to the group. | `RESEARCH.md:46` |
| Revoking a connection invalidates renewal and blocks new calls immediately; prior messages keep their author. | `RESEARCH.md:54` |
| Sends accept an idempotency key to avoid duplicates during retries. | `RESEARCH.md:46, 65` |
| The UI must show whether an agent has reception configured, to avoid promising automatic responses. | `RESEARCH.md:19, 69` |
| Initial scope excludes hosting or keeping the external process alive. | `RESEARCH.md:19` |
| Scope exclusions: public channels/workspaces, threads, files, calls, advanced search, chat imports, platform-hosted agents, per-client SDKs, internal automations, enterprise roles. | `RESEARCH.md:32-40` |
| MVP acceptance criteria are listed as eight bullets. | `RESEARCH.md:73-80` |
| Four product decisions were explicitly left open. | `RESEARCH.md:84-87` |
| The next design step is to validate open decisions and define screens, data schema, MCP authorization contract, and the end-to-end test. | `RESEARCH.md:89-91` |

## Resolved inputs applied to this PRD

The delegating parent supplied five approved product inputs. They outrank the open-decision
list in `RESEARCH.md`:

| # | Approved input |
|---|---|
| 1 | Groups are private. |
| 2 | Each agent identity is bound to one visible human owner; ownership is immutable in the MVP. |
| 3 | Agent connection uses MCP OAuth; agent credentials act only as the agent, never as the owner. |
| 4 | An agent may publish spontaneously without a mention or prior incoming message. |
| 5 | Inbound reception exists only while the external agent runtime is active. |

Input 5 is the decisive resolution of the durable-inbox conflict (see `01-research-questions.md`
→ Contradiction resolution).

## Contradictions found

### C1 — Durable pending inbox vs runtime-active-only reception (resolved)

`RESEARCH.md` includes a durable pending inbox as MVP scope and models it as
connection-independent (`RESEARCH.md:39, 42-46, 66-67, 79`). Approved input 5 states reception
exists only while the runtime is active.

**Resolution:** input 5 wins. Durable pending-inbox semantics, `get_inbox`/`ack_inbox`, and
`AgentInboxEvent` are excluded from MVP product scope. No offline event delivery or replay is
promised. On-demand history read after reconnect is permitted but is **not** event replay.
The transport remains a System Design question.

### C2 — "Real-time messages" vs runtime-active reception (reconciled)

`RESEARCH.md` promises "Mensajes de texto en tiempo real" (`RESEARCH.md:35`) and an "inbox de
eventos" (`RESEARCH.md:39`). Real-time applies to the **human chat surface** (people see each
other's messages without reloading). It does not extend to the external agent runtime, which
only receives while active. The PRD keeps human real-time as product behavior and scopes agent
reception per input 5.

### C3 — Polling inbox as the pilot reception path (superseded)

`RESEARCH.md:69` proposes "inbox con polling" for the pilot and a webhook receiver as a next
delivery. Because C1 removed the durable inbox, polling an event inbox is not a valid pilot
answer. Any reception mechanism is deferred to System Design and must not promise offline
delivery.

## Gaps

- **No implementation baseline.** No stack, schema, build, test runner, or commands exist.
  Stack and test capability belong to a later gate, not the PRD.
- **Event transport undecided** (deferred, RQ12).
- **MCP OAuth server details undecided** (deferred, RQ14): authorization-server metadata,
  token issuance/introspection, client compatibility.
- **Data model undecided** (deferred, RQ13). The entity sketches in `RESEARCH.md:42-46` are
  non-binding.
- **No screens or UX specification** beyond the minimal flow (`RESEARCH.md:23-28`).
- **No non-functional targets** (latency, scale, availability) are stated; the PRD records
  only observable behavior.

## Product-vs-design boundary

This boundary is deliberate and binding on downstream phases.

| Belongs to the PRD (product) | Belongs to System/Program Design (later) |
|---|---|
| Who the users are and what problem the MVP solves | Exact entity/schema definitions and indexes |
| Observable behavior: private groups, agent identity + visible owner, shared conversation, authorship display | Table/collection layout and persistence technology |
| Authorization and privacy *behavior* and promises | MCP OAuth implementation: flows, token format, introspection, metadata endpoints, client compatibility |
| Runtime-active reception as observable behavior and its limits | Event transport/protocol (polling, persistent connection, webhook) |
| Spontaneous send and idempotency as user-visible guarantees | Idempotency-key storage and dedup mechanics |
| Success evidence / acceptance criteria (outcomes) | File-level changes, module boundaries, migration, and test commands |
| Boundaries, non-goals, risks | Stack selection and test capability |

The PRD must not promote the `RESEARCH.md` entity/schema sketches
(`RESEARCH.md:42-46`) or the tool list (`RESEARCH.md:60-67`) into binding architecture. It may
reference them as non-binding context only.
