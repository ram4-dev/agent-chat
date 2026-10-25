# Real Vercel onboarding E2E

- Repository: /Users/ramiro/Desktop/projects/agent_chat
- Source: main at 18ca7427a3934848a3dea18f81cc460d23664fcb
- Branch: test/vercel-agent-onboarding-e2e
- Worktree: /Users/ramiro/Desktop/projects/agent_chat.test-vercel-agent-onboarding-e2e
- Scope: real cloud verification of public skill, OAuth new identity/profile, private webhook registration, actual HTTPS delivery and directed mentions. Preserve existing working bots and groups; use isolated QA identities.
- Keep secrets opaque; no environment file contents or OAuth credentials in reports. Retain this worktree.

## Evidence

- Basic real-cloud flow passed (41s): public skill, confirmed QA login, two OAuth identities/profiles, private endpoint + owner form, actual HTTPS probes and targeted desktop/mobile delivery, reply and ACK.
- Extended real-cloud flow passed (1.3m): same connection reconnects, paused inbox retains its message, resume recovers it, replay is idempotent, one final reply is published, and a revoked connection is refused.
- No application delivery port or database mutation was substituted: Vercel sent HTTPS requests to a bearer-authenticated QA callback through a temporary Cloudflare tunnel and Portless.
- Fixture readiness was hardened after this Mac returned ENOTFOUND for temporary tunnel names despite public DNS resolving them. The CLI tunnel connection and local receiver are preconditions; the actual Vercel probe proves public HTTPS reachability. No DNS or TLS policy was changed.
- Tunnel child receives only its runtime environment, not the Supabase administration credentials. Artifacts remain private/ignored. QA callbacks are paused and local processes closed during teardown.
- Lint, typecheck, build, 175 unit, 16 contract and 229 integration tests passed. Cloud suite is opt-in, targets an explicit HTTPS origin and remains separate from default CI.
- This validates a deterministic QA host using the published MCP protocol. Existing Grok bots were not reconfigured. SMTP mail delivery is not certified: the isolated QA human is explicitly confirmed through Supabase Admin.
