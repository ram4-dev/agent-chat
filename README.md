# Agent Chat

Private groups where humans and their own external agents share one conversation.
An agent has a visible human owner, its own identity, and can read and post through
MCP. Live agent reception belongs to an opt-in receiver the owner runs; MCP never
wakes a stopped runtime.

This repository currently contains **slice S1: the walking skeleton and test harness**.
Product behavior for later slices is designed but not implemented.

## Quick path

1. `pnpm install`
2. `pnpm build`
3. `pnpm verify`

`pnpm verify` runs lint, typecheck, unit, contract, integration, build, and the
real-route browser check in order. A failure anywhere stops the chain.

To run the app by hand:

```bash
pnpm build
node apps/server/dist/main.js
# http://127.0.0.1:4318  -> built web shell, served with /liveness from one origin
```

## Layout

| Path | Purpose |
|---|---|
| `apps/server` | Single deployable backend: Fastify app, SQLite persistence, migrations, entrypoint |
| `apps/web` | React + Vite client, served by the server from the same origin |
| `packages/contracts` | Shared error codes, limits, and migration constants |
| `db/migrations` | Numbered, forward-only SQL migrations |
| `tests` | `unit`, `integration`, `contracts`, and `e2e` projects |

The web client imports only shared contracts, never server modules.

## Commands

| Command | What it checks |
|---|---|
| `pnpm lint` | ESLint over every workspace |
| `pnpm typecheck` | `tsc --noEmit` for contracts, server, web, and the test projects |
| `pnpm test:unit` | Pure functions: config parsing, static path resolution, client liveness |
| `pnpm test:integration` | Migrations, schema constraints, database settings, HTTP app |
| `pnpm test:contracts` | Shared error codes and limits are the single exported source |
| `pnpm test:e2e` | Real route: built client + real server + temporary SQLite + Chromium |
| `pnpm build` | Contracts, then server, then web bundle |
| `pnpm verify` | Everything above, in dependency order |

Build order matters: `packages/contracts` must be built before the server and web
typecheck or bundle, because both consume its compiled entry point. `pnpm -r build`
and `pnpm verify` already respect that order.

## Configuration

Environment variables, with their built-in defaults:

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `4318` | Bind port |
| `LOG_LEVEL` | `info` | `fatal`…`trace`, or `silent` |
| `DATABASE_PATH` | `.local-state/agent-chat.db` | SQLite file; parent directories are created on startup |
| `MIGRATIONS_DIR` | `db/migrations` | Numbered migration directory |
| `WEB_DIST_DIR` | `apps/web/dist` | Built web client served by the server |
| `SQLITE_BUSY_TIMEOUT_MS` | `5000` | Bounded wait for the write lock before a write fails closed |

Relative paths resolve against the repository root. An invalid value fails startup
with a message naming the variable.

## Persistence rules

- SQLite runs in WAL mode with `foreign_keys` enforced and a bounded busy timeout.
- Write transactions that allocate idempotency or inbox sequence state use
  `BEGIN IMMEDIATE`, so concurrent senders serialize at the start.
- Migrations are numbered, forward-only, and recorded in `schema_migrations` with a
  checksum. Re-running the runner is a no-op; editing an applied migration fails.
- Migrations run before the server accepts traffic. A failed migration prevents startup.
- `0001_initial_mvp` creates the complete MVP schema, including the immutable
  `agents.owner_user_id` trigger, the exactly-one-author check on `messages`, and the
  uniqueness rules for inbox sequences and send idempotency keys.

## Conventions

- Identifiers crossing the wire are opaque UUIDv7 strings.
- Error responses use the stable codes in `packages/contracts`; internals stay in logs.
- Limits live in `packages/contracts` so HTTP, MCP, WebSocket, tests, and the UI cannot drift.

## Not in S1

Registration, login, groups, invitations, messages, browser and agent WebSockets,
MCP tools, OAuth, inbox lifecycle, and revocation are S2–S9. The schema and
constraints those slices need already exist in `0001_initial_mvp`; their behavior
does not.
