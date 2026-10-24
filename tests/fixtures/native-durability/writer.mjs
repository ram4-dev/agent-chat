import process from 'node:process';
import { copyFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createDatabase } from '../../../apps/server/dist/persistence/client.js';
import { migrateFromDirectory } from '../../../apps/server/dist/persistence/migrate.js';
import { createServices } from '../../../apps/server/dist/services.js';
const [root, extension, scenario] = process.argv.slice(2);
const path = join(root, 'writer.db');
const baseline = createDatabase({ path, busyTimeoutMs: 1000 });
migrateFromDirectory(baseline.sqlite, resolve('db/migrations'));
const owner = randomUUID();
baseline.sqlite.prepare('INSERT INTO users(id,email,password_hash,display_name) VALUES(?,?,?,?)').run(owner, `${owner}@example.com`, 'fixture', 'Fixture');
const services = createServices(baseline);
const groupId = services.groups.createGroup({ userId: owner, name: 'Durability fixture' }).group.id;
const agent = services.agents.createAgent({ ownerUserId: owner, name: 'Fixture' });
services.groups.admitAgent({ userId: owner, groupId, agentId: agent.id });
const clientId = randomUUID();
baseline.sqlite.prepare('INSERT INTO oauth_clients(client_id,client_name,redirect_uris) VALUES(?,?,?)').run(clientId, 'fixture', '[]');
const connection = services.agents.createConnection({ agentId: agent.id, oauthClientId: clientId });
const targetId = randomUUID();
services.nativeAccess.repository.registerTarget({ id: targetId, ownerUserId: owner, provider: 'hermes', connectorId: 'fixture-only', nativeRef: 'synthetic', contextMode: 'native_per_group' });
const { publicKey } = generateKeyPairSync('ed25519');
services.nativeAccess.setProofKey(owner, targetId, publicKey.export({ format: 'pem', type: 'spki' }).toString());
baseline.sqlite.prepare('UPDATE native_runtime_targets SET capabilities_json=? WHERE id=?').run(JSON.stringify({ groupIsolation: 'verified', durableResults: 'verified', approvals: 'verified', toolCatalog: 'verified', nativeVisibility: 'verified' }), targetId);
const binding = services.nativeAccess.createOwnedBinding(owner, { agentId: agent.id, targetId, groupIds: [groupId] });
const challenge = services.nativeAccess.createChallenge(owner, { kind: 'automatic', connectionId: connection.id, bindingId: binding.id, revision: 1, targetId, scopes: ['native:read','native:claim','native:start','native:complete'] });
services.nativeAccess.consumeChallenge(connection.id, challenge.challenge, { bindingId: binding.id, revision: 1, targetId });
services.nativeDelivery.configureOwner(owner, binding.id, 1, true);
services.messaging.send({ author: { kind: 'human', id: owner }, groupId, text: 'Durability input', idempotencyKey: 'fixture' });
baseline.close(); // Healthy, checkpointed initial disk; no native claim exists yet.
copyFileSync(path, join(root, 'durable.db'));
process.env.TEST_SYNC_TARGET = realpathSync(path);
process.env.TEST_SYNC_DB_IMAGE = join(root, 'durable.db');
process.env.TEST_SYNC_WAL_IMAGE = join(root, 'durable.wal');
// Keep the loader alive: SQLite's VFS function pointers belong to this extension.
const loader = createDatabase({ path: ':memory:', busyTimeoutMs: 1000 });
loader.sqlite.loadExtension(extension);
const writer = createDatabase({ path, busyTimeoutMs: 1000 });
writer.sqlite.pragma('wal_autocheckpoint=0');
// Negative controls deliberately emulate the old NORMAL policy; production has no such option.
if (scenario === 'normal-all') writer.sqlite.pragma('synchronous=NORMAL');
const runtime = createServices(writer).nativeDelivery;
const controllerId = randomUUID(); const { epoch } = runtime.open(connection.id, controllerId);
const delivery = runtime.next(connection.id, controllerId, epoch).delivery;
if (scenario === 'normal-begin') writer.sqlite.pragma('synchronous=NORMAL');
runtime.begin(connection.id, delivery.ticket);
// Simulated external side effect, outside the server's disk image. Controller B has no journal A.
writeFileSync(join(root, 'dispatched'), delivery.startKey, { mode: 0o600 });
process.send({ type: 'begin-acknowledged', connectionId: connection.id, eventId: delivery.ticket.eventId, startKey: delivery.startKey,
  syncCalls: loader.sqlite.prepare('SELECT sync_image_count() AS n').get().n, syncLevel: writer.sqlite.pragma('synchronous', { simple: true }) });
globalThis.setInterval(() => {}, 1000); // Parent kills without checkpoint/close, then restores only synced bytes.
