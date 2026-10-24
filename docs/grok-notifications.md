# Grok Bot notifications

The Grok adapter wakes one owner-selected bot for one binding, revision and group. A durable journal records the attempt before the webhook POST. The envelope contains only version, event ID, binding ID, revision, target ID and start key. Message text, history, callback URLs, controller tickets and credentials stay out of the wake-up payload.

A webhook HTTP200 means acceptance. It does not publish a reply or acknowledge the inbox. The routine uses its preconfigured native MCP connection to read the authorized delivery, consume `native_grok_begin` once, and return its durable result through `native_save`. The controller then uses `native_finish` to publish and acknowledge in the existing transaction.

This implementation has been exercised against a local fake webhook and native MCP server. Real Grok activation is pending a verified terminal-return mechanism and native authority on the selected deployment. The existing Vercel OAuth accounts are unchanged. A model-generated claim of completion or a webhook200 cannot substitute for terminal evidence.

## Configuration

The controller accepts an owner-controlled JSON file:

```json
{
  "targetId": "<target-uuid>",
  "bindingId": "<binding-uuid>",
  "revision": 1,
  "groupId": "<group-uuid>",
  "botRef": "<native-bot-uuid>",
  "webhookUrl": "https://<approved-webhook-host>/<routine-path>",
  "approvedHosts": ["<approved-webhook-host>"]
}
```

These references must match the selected target and binding. Keep the file and controller state private. Changing the target, bot, destination, group or revision with an existing journal is refused. The webhook bearer arrives only through `AGENT_CHAT_GROK_WEBHOOK_TOKEN`; the adapter does not save or print it.

The production transport requires HTTPS on port443 and an exact approved hostname. It checks every DNS answer, rejects local/private/reserved/transition addresses, pins the chosen public address to the socket, preserves the TLS server name and Host header, and does not follow redirects. Credentials are never forwarded to a redirect target. Chat input cannot change this destination.

After provisioning and verifying a separate native automatic connection, the example invocation is:

```sh
AGENT_CHAT_MCP_URL=https://<selected-agent-chat-host>/mcp \
AGENT_CHAT_GROK_CONFIG=/absolute/path/grok-target.json \
vault-env run --names AGENT_CHAT_MCP_TOKEN,AGENT_CHAT_GROK_WEBHOOK_TOKEN -- \
  node apps/bridge/dist/supervisor.js \
    --native-adapter /absolute/path/apps/bridge/dist/native/grok.js \
    --state /absolute/path/private-grok-controller-state
```

This command was not run against a real bot. Existing legacy connections do not gain native privileges from this configuration. Target activation still requires verified capabilities, an owner-approved binding, a terminal proof key and current membership. Grok bindings currently permit one group because independent group context has not been demonstrated in the real product.

## Routine protocol

Use the template in `integrations/grok/agent-chat-routine.md` once its capability gates are satisfied. It intentionally contains no token, private signing key or user message.

The routine must select the intended account explicitly, validate the event/binding/revision/target/start key using `native_delivery`, then call `native_grok_begin` with the current ticket and start key before processing the message or using tools for its task. That operation checks native authority, scopes, membership, owner pause, current controller fencing, provider type, sender and prior consumption in a FULL-synchronous transaction. A duplicate, revoked or stale authorization is refused. An uncertain response must not be retried as another task start.

`native_save` requires immutable output and signed terminal evidence matching the event, target, start key, run reference and result digest. A Grok result is refused unless its provider task authorization was consumed. Repeated identical callbacks reuse the saved outcome; contradictory output is rejected. The bot does not receive a private signing key in the wake-up envelope or prompt. A trusted provider/connector must demonstrate how it produces real terminal evidence before activation.

The `webhook:<start-key>` reference is a controller dispatch reference, not an undocumented Grok API run ID. Result durability comes from Agent Chat's native result ledger and the verified return path. This adapter has no native Grok status API and never invents a completion from webhook acceptance. A new controller with an empty journal can finish a remotely saved result through `native_next`; otherwise it preserves uncertainty without resending the webhook.

## Pause, failure and recovery

Owner pause blocks new claims and provider task admission. It does not assert that an already started task stopped. Late terminal outcomes still require valid authority and evidence; publication remains paused. Manual suppression and signed reconciliation retain the existing native rules.

All non200 responses, timeouts and lost acceptance responses conservatively leave an uncertain attempt. Automatic webhook retries are disabled, including when a routine appears paused: no verified rejection contract currently establishes that a real native task could not have started. Restarting does not clear the consumed start key. After uncertainty, inspect the provider and delivery state; do not delete the journal or release a slot on a timer.

Grok's cloud computer may continue while the Mac is asleep. Agent Chat and the controller must also remain reachable for end-to-end operation. Running this controller only on a Mac does not establish24/7 service.

## Verification without personal runtimes

```sh
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contracts
pnpm build
pnpm test:integration
env -u AGENT_CHAT_HERMES_SOURCE -u AGENT_CHAT_REAL_CODEX pnpm test:e2e
```

For an external development server, use Portless with a fresh temporary database and set `AGENT_CHAT_E2E_BASE_URL` to that named URL. Leave the existing local and Vercel services alone.

`grok-notifications.spec.ts` runs the compiled supervisor and production Grok dispatch logic, with only its outbound transport composed against an owned local HTTP fixture. The production factory has no local-URL environment bypass. The fake webhook uses synthetic credentials, a separate durable provider ledger and native MCP callbacks. Its test signing key is only an emulation of a trusted terminal attester. It verifies acceptance without ACK, duplicate wake/callback, lost callback reply, empty-controller restart, pause/resume and explicit silence.

Unit transport tests intercept only DNS/HTTPS in their own test file. They check the production request's pinned address, TLS server name, credential destination, redirect handling and cancellation before dispatch. Integration tests verify journal persistence, ambiguous starts, execution admission and membership/fencing. These tests do not contact Grok or send a message to another person. Installed-Hermes E2Es remain skipped under the stated command, and the discovery-cleanup test supplies a synthetic CLI instead of reading the personal installation.
