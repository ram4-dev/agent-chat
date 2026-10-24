# Managed receiver on macOS

- Source repository: `/Users/ramiro/Desktop/projects/agent_chat`.
- Source branch/commit: `main`, `addca0963a8dfae76ee3ee4b0897459cd7272baa`.
- Worktrunk branch: `feat/managed-mac-receiver`.
- Worktree: `/Users/ramiro/Desktop/projects/agent_chat.feat-managed-mac-receiver`.
- Authorization: user selected this Mac as the host while powered on; prepare a managed OAuth receiver and macOS launch service.
- Reuse the existing restricted Codex worker; do not alter personal agents or existing SQLite launch services.
- Required behavior: explicit OAuth consent, private credential storage, live receiver readiness, durable inbox recovery, idempotent reply publication, ACK only after processing, uncertain generation held for review, automatic reconnect and restart, no agent reply loops.
- Keep worktree for review. Do not overwrite unrelated services.

## Validation

- Local Supabase: full verify completed with 174 unit, 15 contract, 226 integration at the first snapshot, 11 managed integration and 31 browser E2Es; one real-model test excluded from the default suite. The added operator-resolution integration brought the processor slice to five passing tests and is included in the final CI snapshot.
- Real Codex acceptance: both protocol and real worker passed authorization, live receive/reply/ACK, shutdown, pending recovery and thread resume locally.
- The same two acceptances passed against public Vercel with real Codex (53.2 seconds). Cloud tests seed confirmed QA identities; external email delivery is not claimed.
- Cloud stop initially exposed abrupt TCP termination delaying presence cleanup. Graceful WebSocket close fixed it without changing assertions or timeouts.
- Final lint, typecheck, build passed. Packaged managed runtime verified outside the repository using actual SDK, ws and native SQLite dependencies.
- Personal OAuth consent and launch service activation remain the final interactive step.
