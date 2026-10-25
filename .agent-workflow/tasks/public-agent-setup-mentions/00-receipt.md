# Public agent setup and directed mentions

- Repository: /Users/ramiro/Desktop/projects/agent_chat
- Source: main at 2b7f55bcdc70f770a4e80babb8ccb560254ab096
- Branch: feat/public-agent-setup-mentions
- Worktree: /Users/ramiro/Desktop/projects/agent_chat.feat-public-agent-setup-mentions
- Scope: public shareable setup skill, self profile/configuration under explicit OAuth permission, directed @mentions in both backends, UI and E2E.
- New identity creation remains part of owner-approved OAuth. Host-only webhook credentials remain private; document any host limitation honestly.
- No unrelated changes; retain worktree.

## Implementation and validation

- Public setup skill at /skills/agent-chat/SKILL.md and /skill.md; discovery at /.well-known/agent-chat.json; platform copy field under Connect client.
- Optional owner-approved agent:manage scope, self-only profile tool and a separate bearer-authenticated private webhook registration endpoint. Default scopes and existing JWT grants remain unchanged. New identity creation remains in OAuth consent.
- Mention selection persists explicit IDs in both databases and includes recipient selection in idempotency. Only selected active group agents receive inbox jobs; existing receiver and webhook paths consume those jobs. Without selected mentions, the prior group broadcast remains.
- Checks passed: lint, typecheck, build; 175 unit, 16 contract, 229 integration and 16 managed integration tests. Skill validators passed.
- Full browser suites: SQLite 38 passed / 12 backend-specific or opt-in skips; Supabase 36 passed / 1 real-model opt-in skip. Final focused setup/mentions run: 3 passed.
- Supabase E2E reused the repository's external-server workflow on its fixed recovery/OAuth test origin. Reset only the named disposable local database data after discovering accounts left by the earlier test run. No cloud data cleared; no assertions or timeouts relaxed.
- Desktop/mobile screenshots inspected; mention picker and delivered-target labels fit the mobile viewport.
- Two configured bots in managed E2E: a human mention produced one inbox event and one webhook only for the selected bot. Actual Grok routine creation remains host-owned; no live Grok account or credential was modified by these tests.
- Production additive migration 20261025000100 installed; existing data preserved.
