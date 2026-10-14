# 01 — Research Questions

Task slug: `agent-chat-mvp`
Artifact revision: 1 (draft)

These are **evidence-first** questions about current state and unresolved product
decisions. Each carries a status. "Answered" means the repository or an approved user input
settles it; "Proposed" means a default is awaiting PRD approval; "Deferred" means the
question is real but is not a product question and moves to a later design gate. No question
is left open merely for ceremony.

Status legend:

- **Answered** — settled by evidence or by an approved user input.
- **Proposed** — a recommended default awaiting approval of the integrated PRD; blocks
  nothing in the PRD, but must be confirmed with the revision.
- **Deferred** — a genuine open question that belongs to System/Program Design and is
  explicitly out of PRD scope.

## Evidence scope

- Repository: `RESEARCH.md` (product research), `AGENTS.md`, `herdr-session.md`, and the
  working tree (`git status`, `git log`).
- Approved user inputs forwarded by the delegating parent (five product decisions, listed in
  `03-prd.md`).
- No implementation baseline exists to inspect (see `02-research.md`).

## Questions

| ID | Question | Status | Resolution | Source |
|---|---|---|---|---|
| RQ1 | Does the repository contain any implementation baseline that constrains MVP product choices? | Answered | No. The tree holds research and workflow artifacts only; `RESEARCH.md` states the repo was empty at research start and the working tree confirms it. | `RESEARCH.md:91`; `git log` (`751d3e7` initial research, `c83efac` session receipt) |
| RQ2 | Are groups private or public in the MVP? | Answered | **Private.** Groups are invitation-only and not publicly discoverable. | Approved user input 1; `RESEARCH.md:32-40` scopes public channels to "later" |
| RQ3 | Is an agent's human owner visible and immutable? | Answered | **Yes — visible and immutable in the MVP.** Each agent identity is bound to one visible human owner; ownership cannot be transferred in the MVP. | Approved user input 2; `RESEARCH.md:13-19, 48-54` |
| RQ4 | How does an agent authenticate, and whose identity do its credentials carry? | Answered | **MCP OAuth.** Agent credentials act **only as the agent, never as the owner**. | Approved user input 3; `RESEARCH.md:48-54, 56-67` |
| RQ5 | May an agent publish without a mention or a prior incoming message? | Answered | **Yes.** Autonomous publishing is allowed; `send_message` requires neither a mention nor a prior message. | Approved user input 4; `RESEARCH.md:19, 65` |
| RQ6 | Is inbound reception an always-available platform capability? | Answered | **No.** Inbound reception exists **only while the external agent runtime is active**. The platform makes no offline-delivery promise. | Approved user input 5 |
| RQ7 | Does the MVP require a durable pending event inbox (`get_inbox`/`ack_inbox`, `AgentInboxEvent`)? | Answered | **No — excluded.** The durable-inbox design contradicts RQ6 and is resolved in favor of RQ6. See contradiction below. | Approved user input 5 vs `RESEARCH.md:39, 44, 66-67, 79` |
| RQ8 | Web only, or also a native mobile app, for the first launch? | Proposed | **Responsive web app only; no native mobile app.** Awaiting PRD approval. | `RESEARCH.md:84` (open decision 1) |
| RQ9 | May an agent join another person's private group? | Proposed | **Yes, only after explicit group-admin approval.** Awaiting PRD approval. | `RESEARCH.md:85` (open decision 2) |
| RQ10 | Who may edit an agent profile in the MVP? | Proposed | **Only the owner.** The agent cannot edit its own profile. Awaiting PRD approval. | `RESEARCH.md:87` (open decision 4) |
| RQ11 | Must an agent respond automatically when addressed? | Proposed | **No automatic response is promised.** The external runtime decides whether to respond; the UI must not imply otherwise. Awaiting PRD approval. | `RESEARCH.md:19, 69, 86` (open decision 3) |
| RQ12 | What is the exact event transport/protocol for runtime-active reception? | Deferred | **Out of PRD scope.** The PRD specifies only the observable behavior of runtime-active reception; the transport is a System Design question. Keeping the old `RESEARCH.md` polling/inbox proposal as the answer would contradict RQ6. | `RESEARCH.md:66-67, 69`; approved user input 5 |
| RQ13 | What is the exact data model (entities, fields, indexes)? | Deferred | Out of PRD scope; Do not promote `RESEARCH.md:42-46` entity sketches into the PRD. System Design owns it. | `RESEARCH.md:42-46` |
| RQ14 | What is the concrete MCP OAuth authorization-server implementation and client compatibility? | Deferred | Out of PRD scope. The PRD states only that authorization is MCP OAuth and separates agent identity from human identity; implementation details go to System Design. | `RESEARCH.md:48-54` |
| RQ15 | Which stack, test capability, and test commands verify the MVP? | Deferred | Out of PRD scope. Determined at TDD/verification time, once an implementation baseline exists. | `02-research.md` (no baseline) |

## Contradiction resolution (RQ6 vs RQ7) — RECORDED

**Conflict.** `RESEARCH.md` presents a *durable pending inbox* as MVP scope in three places:

- The product-limits table lists "Lectura, publicación e inbox de eventos" as included
  (`RESEARCH.md:39`).
- The permission model introduces `AgentInboxEvent` "para recuperar eventos pendientes sin
  depender de una conexión permanente" (`RESEARCH.md:44`, within the model section
  `RESEARCH.md:42-46`).
- The MCP tool catalog includes `get_inbox` and `ack_inbox`, and the acceptance criteria
  state "Un evento nuevo queda disponible en el inbox; después de reconocerlo no vuelve como
  pendiente" (`RESEARCH.md:66-67, 79`).

This asserts a durable, connection-independent pending-event store. Approved user input 5
asserts the opposite: inbound reception exists only while the external runtime is active.

**Resolution — decision 5 wins.** The following are **excluded from MVP product scope**:

- Durable pending-inbox semantics.
- The `get_inbox` and `ack_inbox` tools as product surface.
- `AgentInboxEvent` as a product entity.

**Consequences recorded deliberately:**

- The MVP makes **no offline event-delivery or replay promise**. A disconnect means the
  event is not delivered to that runtime.
- An agent runtime **may later read group message history on demand** after reconnecting.
  This is a **history read**, explicitly **not** inbox or event replay.
- The **exact event transport/protocol remains a System Design question** (RQ12). It may or
  may not use polling, a persistent connection, or a webhook; that choice is downstream. The
  PRD commits only to the observable behavior of reception while the runtime is active.

This resolution is binding on `03-prd.md` and any later design artifact. `RESEARCH.md` is not
edited (out of write scope); this note supersedes the relevant scope within it.

## Outstanding questions after this task

No question above remains **open and blocking** for the PRD. Four **Proposed** defaults
(RQ8–RQ11) require confirmation as part of approving PRD revision 1; a reviewer who rejects a
default changes the PRD and supersedes the gate rather than reopening a research question.
