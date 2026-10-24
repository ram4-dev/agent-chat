# PostgreSQL disconnect resilience

- Repository: `/Users/ramiro/Desktop/projects/agent_chat`.
- Source: `main`, `addca0963a8dfae76ee3ee4b0897459cd7272baa`.
- Worktrunk branch: `fix/postgres-disconnect`.
- Worktree: `/Users/ramiro/Desktop/projects/agent_chat.fix-postgres-disconnect`.
- Scope: handle checked-out PostgreSQL client failures, preserve transaction errors when rollback fails, discard broken connections, and prove recovery with real local database fault injection and managed browser E2Es.
- Do not retry business transactions automatically.
- Preserve existing worktrees and keep this worktree available for review.

## Evidence

Three separate-process tests using pg_terminate_backend against the local database failed before the fix and pass after it. They exercise a checked-out idle client, preservation of the application failure, and a query interrupted by connection termination. Each verifies exactly one operation attempt and successful recovery on a new connection. Verification logs remain in the ignored local state directory.
