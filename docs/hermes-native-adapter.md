# Hermes native profile adapter

The adapter connects Agent Chat to the API server of one explicitly selected Hermes profile. It sends native runs without overriding the profile's model, instructions, toolset or approval policy. Its session key is `agent-chat:<binding>:<group>:<generation>`; participants in a group share that session while their real author IDs are preserved.

This implementation is under review. Production activation and acceptance with an owner-selected profile remain pending. The automated tests use Hermes source at `d923a5eb487a17c0a68801bba9ef0f56c81040a8`, disposable profiles and a fake inference provider. They do not establish compatibility with other Hermes releases or prove continuous availability of a personal Mac.

## Recovery plugin

The project-local plugin is in `integrations/hermes/agent-chat-runtime`. It registers read-only routes through Hermes's `api_server` plugin hook. A deployment must install and explicitly enable this plugin in the selected profile before starting its gateway. Installing or enabling it in a personal profile is a separate owner action; the tests only copy it into temporary profiles.

The plugin hashes the inspected Hermes modules and refuses recovery for unknown code. Its routes use native profile resolution and native status authorization:

- `GET /agent-chat/v1/profiles/<profile>/capabilities`
- `GET /agent-chat/v1/profiles/<profile>/runs/by-key/<key>`, with `X-Agent-Chat-Fingerprint` matching the original request.

The second route reads the native idempotency mapping and stored result without creating, reserving, pruning or replaying a run. Native normal completion is accepted only after the inspected executor-completion path. An interrupted, failed or cancelled run remains uncertain: cancellation can finish its HTTP handler while a worker is still executing. The connector advertises `cancel: false` and leaves these cases for review. It never retries a run creation when the original response is lost or its native record has expired.

## Controller configuration

Create an owner-controlled JSON file containing only public target metadata:

```json
{
  "targetId": "<registered-target-uuid>",
  "profileRef": "<selected-profile>",
  "origin": "https://<approved-Hermes-host>/p/<selected-profile>"
}
```

The server target must use provider `hermes`, the selected profile as `nativeRef`, and the public half of the connector's Ed25519 signing key. Target capabilities must be verified before enabling a binding. Pair a dedicated automatic connection with that exact binding, revision, target and groups. Agent Chat's owner controls activation and pause; native Hermes authentication and approval settings still apply.

Start the built controller with opaque credentials supplied by `vault-env`:

```sh
AGENT_CHAT_MCP_URL=https://agent-chat.localhost/mcp \
AGENT_CHAT_HERMES_CONFIG=/absolute/path/hermes-target.json \
vault-env run --names AGENT_CHAT_MCP_TOKEN,AGENT_CHAT_HERMES_TOKEN,AGENT_CHAT_HERMES_SIGNING_KEY -- \
  node apps/bridge/dist/supervisor.js \
    --native-adapter /absolute/path/apps/bridge/dist/native/hermes.js \
    --state /absolute/path/private-controller-state
```

The vault must contain those named secrets. Keep the state directory private and durable. The configuration rejects a different profile URL and non-HTTPS remote endpoints. Local `.localhost` development routes may use HTTP. The adapter checks the remote profile and recovery capabilities before dispatch. Moving an existing local journal to another target, profile, endpoint or signing identity is rejected.

A native approval remains pending in Hermes until the human approves it through an authorized native surface. This adapter never approves requests automatically. Native session history remains available through Hermes's authenticated session API; no visibility in an arbitrary open Codex session is implied.

## Storage and recovery

The controller consumes each start authorization durably before its single native POST. A new controller with an empty local store can find a completed run by its original request fingerprint and recover its result. A missing or incompatible native record remains blocked instead of generating again. Agent Chat commits publication and inbox acknowledgment together.

The adapter stores recoverable results and signed evidence locally using SQLite FULL. Unconfirmed results remain available. After Agent Chat returns a durable receipt, result bodies and evidence expire after seven days; minimal start tombstones remain to prevent replay. Startup checks receipts for up to 100 unconfirmed local results; unavailable or revoked reads leave those results retained. Hermes's own history and idempotency retention follow its native configuration and are not purged by this plugin.

## Verification

Install project dependencies, build, then run:

```sh
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contracts
pnpm build
pnpm test:integration
AGENT_CHAT_HERMES_SOURCE=/absolute/path/hermes-agent pnpm test:e2e
```

Hermes tests require its runtime CLI, Git, Python/uv and Portless. They archive only tracked source into disposable directories, exclude private environment files, and isolate HOME and managed configuration. The approval fixture executes a native terminal command only after the test approves it; its target is an empty directory created inside that fixture.

`hermes-delivery.spec.ts` exercises browser input, OAuth/pairing, the compiled supervisor and Hermes adapter, native runs, shared group history, a different group, approval and silence. It drops the controller's run-reference registration, restarts Hermes, and recovers through a second empty controller without a new completion. `hermes-gates.spec.ts` covers native approval, cancellation with an active executor and separate named profiles. `hermes-runtime.test.ts` checks signatures, exact outgoing fields, local replay prevention and receipt-dependent retention.

Real-profile acceptance still requires the owner to select a profile, verify its prompt/tools and native approval surface, and approve a harmless temporary operation. Grok bot callback/network acceptance and Codex profile integration are separate slices.
