# 00 — Intake

Task slug: `agent-chat-mvp`
Artifact revision: 1 (draft)
Date: 2026-10-14
Worktree: `/private/tmp/agent-chat-bootstrap.feat-agent-chat-mvp` (branch `feat/agent-chat-mvp`)

## Outcome

Produce the PRD-gate planning artifacts for the group-first agent chat MVP so that a
single accountable human can approve **what** to build and **why**, before any technical
design or implementation is authorized.

This task delivers documents only. Its success is a reviewable, integrated PRD, not code.

## Acceptance evidence

- Four artifacts exist and are internally consistent:
  `00-intake.md`, `01-research-questions.md`, `02-research.md`, `03-prd.md`.
- `03-prd.md` states users, problem, desired behavior, key flows, authorization and
  privacy behavior, runtime-active reception, success evidence, boundaries, non-goals,
  risks, proposal defaults, and a populated gate record.
- The PRD's acceptance criteria name a real route (browser + server + OAuth-capable MCP
  client), authorization tests, revocation, idempotency, spontaneous send, active-runtime
  live receipt, disconnect/offline behavior with **no** pending inbox delivery, and an
  on-demand history read that is explicitly distinct from event replay.
- The `RESEARCH.md` durable-inbox conflict is resolved in favor of the approved decision 5
  and that resolution is recorded in both `01-research-questions.md` and `02-research.md`.
- No blocking product question remains beyond approval of the complete PRD revision.
- This task does not modify anything outside its allowed write scope. Pre-existing or
  other-session working-tree changes (the modified `herdr-session.md`, and untracked
  directories/files such as `.agents/`, `.codegraph/`, and `AGENTS.md`) are outside this
  task's attribution; this task writes none of them.

## Authority granted

- Write authority is limited to the four files listed under **Write scope**.
- Planning/analysis authority only. No implementation, migration, dependency, or
  external-system action is authorized.
- The five product decisions forwarded by the delegating parent are treated as **approved
  user inputs** (see `03-prd.md` → Approved product inputs). They still require approval of
  the *integrated* PRD revision that incorporates them.

## Read scope

- `RESEARCH.md` (fully read; the sole substantive product research source in the repo).
- `AGENTS.md` (orchestration rule).
- `.agent-workflow/tasks/agent-chat-mvp/herdr-session.md` (read only; prior session state,
  `status: running`).
- `.agents/skills/*` workflow skills and their referenced models, question banks, and
  task packets.
- Repository root state (`git status`, `git log`) to confirm no implementation baseline.

## Write scope

Exactly these files, all under `.agent-workflow/tasks/agent-chat-mvp/`:

- `00-intake.md`
- `01-research-questions.md`
- `02-research.md`
- `03-prd.md`

Explicitly NOT written: `04-tdd.md`, `05-structure-outline.md`, `90-verification.md`,
`herdr-session.md`, any source file, any schema, any config.

## Non-goals

- No TDD / System Design / Program Design.
- No structure outline or implementation slices.
- No code, schema, migration, OAuth implementation, transport choice, or test commands.
- No modification of `RESEARCH.md`, `AGENTS.md`, or `herdr-session.md`. The PRD resolves
  conflicts by superseding the *scope* of prior research, not by editing it.
- No claim of human approval. The gate below is proposed and pending.

## Consequence / uncertainty / reversibility / recurrence

| Dimension | Assessment |
|---|---|
| Consequence | High — identity binding, privacy of groups, and agent authorization carry lasting, user-visible and hard-to-reverse effects. |
| Uncertainty | Medium — product intent is mostly settled by approved inputs; the largest unresolved area is technical (MCP OAuth, event transport), which belongs to design. |
| Reversibility | Low for product-level identity/privacy semantics once built; the artifacts themselves are cheap to revise. |
| Recurrence | Single delivery (not a recurring autonomous loop). |

## Selected route

**PRD-oriented** (`humanlayer-prd-tdd-workflow`).

### Why Oneshot is insufficient

Oneshot assumes a concrete target, a known affected area, cheap rollback, and an
unambiguous write scope with automated verification. Here the deliverable is a product
definition whose choices are costly to reverse (identity binding, private-group privacy,
authorization semantics), and the observable result cannot be verified by a command. The
workflow model reserves Oneshot for reversible, localized changes; this is neither.

### Why RPI is insufficient

RPI resolves current-state research and product/technical choices inside **one** integrated
design discussion, then runs an independent Pi review before the outline. That collapses
two decision classes with different owners and different evidence:

- The **product** decisions (users, behavior, privacy, authorization promise, boundaries,
  success evidence) require their own approval.
- The **technical** decisions (MCP OAuth flow, remote transport, event/reception mechanism,
  data model, realtime delivery, idempotency storage) are substantial and must not be
  silently implied by a design discussion that also settles product intent.

The workflow model is explicit: "If product intent and system design need independent
approval, switch to PRD-oriented." They do here. A front-loaded PRD also lets the product
acceptance criteria — including the offline/no-replay behavior — constrain design instead of
being redefined by it.

## Active gate

**Full PRD approval** of `03-prd.md` revision 1.

| Field | Value |
|---|---|
| Phase | PRD (product intent) |
| Gate | Approval of the complete PRD revision 1 |
| Status | `proposed` — pending human approval |
| Authorized next action | Human review of `03-prd.md` revision 1 |
| Blocked until approval | `04-tdd.md` (System Design, then Program Design), `05-structure-outline.md`, implementation |

No downstream artifact is authorized. This intake is not the controlling artifact; the PRD
is.

## Superseding / gate note (prior Herdr assignment)

`herdr-session.md` records an earlier assignment: "implement the group-first agent chat MVP
described in `RESEARCH.md`." Its **Remaining work** line expects implementation and
verification.

That implementation scope is **superseded** by this PRD-gate planning task. Concretely:

- The prior assignment's implementation authority was never exercised to a durable result.
  `herdr-session.md` reports `status: running`: it records an implementation assignment and a
  required session restart, its result note says results were not persisted before closure,
  and every row of its Verification section is still `pending`. No implementation artifact
  was persisted from that session.
- `AGENTS.md` requires starting a HumanLayer workflow and forbids implementing before the
  workflow's design gate is approved. Under the PRD-oriented route the controlling PRD gate
  was never opened, so implementation was never authorized.
- Any future implementation must be re-authorized against an **approved** PRD, not against
  the stale intake in `RESEARCH.md`.

`herdr-session.md` itself is left unmodified; this note owns the supersession.

## Next authorized action

Human-approved or rejected review of `.agent-workflow/tasks/agent-chat-mvp/03-prd.md`
revision 1. On approval, the next phase is TDD System Design; on revision, supersede this
gate and re-issue at revision 2.
