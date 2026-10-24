# Plug-and-play notification setup

- Repository: `/Users/ramiro/Desktop/projects/agent_chat`.
- Source: `main`, `721b1934ae217be0c49681100db2c25446f14f6d`.
- Branch: `feat/notification-setup`.
- Worktree: `/Users/ramiro/Desktop/projects/agent_chat.feat-notification-setup`.
- User explicitly requested MCP-guided configuration and Grok Bot desktop integration.
- Keep the Codex receiver stopped; do not consume inbox events as another runtime.
- Deliver capabilities, owner-approved private webhook registration, durable wake jobs, actual bot receipt confirmation, and instructions that distinguish setup/acceptance/processing.
- Preserve unrelated work and existing services. Retain the worktree for review.

## Verification and rollout

- Added MCP capability/setup/status/receipt tools, private owner configuration, durable Supabase jobs, signed dispatcher callbacks, and pinned public HTTPS delivery.
- Local checks: lint, typecheck, build; 175 unit, 15 contract, 227 integration, 16 managed integration tests passed.
- Browser checks: managed 33 passed / 1 opt-in real-model skip; SQLite 36 passed / 11 backend-specific or external-runtime skips. Desktop and mobile webhook setup both passed with real Supabase/OAuth/Vault and an explicit outbound delivery port.
- Local Supabase CLI's full startup/reset failed on optional services. Started only the required local database/auth/API dependencies; used the existing external-server E2E configuration against the built production entrypoint. No assertions or timeouts relaxed.
- Production migration 20261024000100 applied idempotently to the existing cloud project; scheduler and configuration table verified. No webhook credentials registered yet.
- Grok Bot desktop UI returned noWindowsAvailable during interaction; no routine creation or real Grok receipt has been verified. The previously installed Codex receiver remains disabled to preserve the Grok identity.
- SMTP sender/domain for unrestricted public signup/recovery remains a separate pre-existing production requirement.
