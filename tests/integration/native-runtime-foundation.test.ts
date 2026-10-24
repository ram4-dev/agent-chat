import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createDatabase, type DatabaseHandle } from '../../apps/server/src/persistence/client';
import { applyMigrations, loadMigrations } from '../../apps/server/src/persistence/migrate';
import { createNativeRuntimeRepository } from '../../apps/server/src/persistence/native-runtime-repository';

const databases: DatabaseHandle[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function setup(beforeNative = false) {
  const db = createDatabase({ path: ':memory:', busyTimeoutMs: 1000 }); databases.push(db);
  const migrations = loadMigrations(resolve('db/migrations'));
  applyMigrations(db.sqlite, beforeNative ? migrations.filter(m => !m.id.startsWith('0008')) : migrations);
  const owner = randomUUID(); const otherOwner = randomUUID();
  const agent = randomUUID(); const second = randomUUID(); const otherAgent = randomUUID();
  const a = randomUUID(); const b = randomUUID();
  for (const id of [owner, otherOwner]) db.sqlite.prepare('INSERT INTO users(id,email,password_hash,display_name) VALUES(?,?,?,?)').run(id, `${id}@example.com`, 'fixture', id);
  for (const [id, user] of [[agent, owner], [second, owner], [otherAgent, otherOwner]]) db.sqlite.prepare('INSERT INTO agents(id,owner_user_id,name) VALUES(?,?,?)').run(id, user, id);
  for (const id of [a, b]) db.sqlite.prepare('INSERT INTO groups(id,name,creator_user_id) VALUES(?,?,?)').run(id, id, owner);
  const repository = createNativeRuntimeRepository(db.sqlite);
  const target = (mode: 'native_per_group' | 'shared_bot_context' | 'unsupported' = 'native_per_group', user = owner) => {
    const id = randomUUID();
    repository.registerTarget({ id, ownerUserId: user, provider: 'hermes', connectorId: 'host-one', nativeRef: id, contextMode: mode });
    return id;
  };
  const bind = (targetId: string, groups: string[] = [a], identity = agent, user = owner) => repository.createBinding({
    id: randomUUID(), ownerUserId: user, agentId: identity, targetId, groupIds: groups,
  });
  const event = (identity = agent, group = a) => {
    const message = randomUUID(); const id = randomUUID();
    db.sqlite.prepare("INSERT INTO messages(id,group_id,author_kind,human_author_id,text) VALUES(?,?,'human',?,'hello')").run(message, group, owner);
    const row = db.sqlite.prepare('SELECT count(*) AS n FROM inbox_events WHERE agent_id=?').get(identity) as { n: number };
    db.sqlite.prepare('INSERT INTO inbox_events(id,agent_id,sequence,group_id,message_id) VALUES(?,?,?,?,?)').run(id, identity, row.n + 1, group, message);
    return id;
  };
  return { db, migrations, repository, owner, otherOwner, agent, second, otherAgent, a, b, target, bind, event };
}

describe('native runtime foundation', () => {
  it('keeps identity/target ownership aligned and hides another owner target', () => {
    const s = setup(); const target = s.target();
    expect(s.repository.findTarget(s.otherOwner, target)).toBeUndefined();
    expect(s.repository.findTarget(s.owner, target)?.capabilities.approvals).toBe('unknown');
    expect(() => s.bind(target, [s.a], s.otherAgent, s.otherOwner)).toThrow();
    expect(s.db.sqlite.prepare('SELECT count(*) AS n FROM native_bindings').get()).toEqual({ n: 0 });
    const binding = s.bind(target);
    expect(binding).toMatchObject({ agentId: s.agent, targetId: target, enabled: false, revision: 1, legacyProjection: false });
    expect(s.repository.findBinding(s.otherOwner, binding.id)).toBeUndefined();
    expect(() => s.db.sqlite.prepare('UPDATE native_runtime_targets SET native_ref=? WHERE id=?').run('other-profile', target)).toThrow('immutable');
  });
  it('enforces shared-bot context across bindings and revisions, not only in the UI', () => {
    const s = setup(); const target = s.target('shared_bot_context'); const binding = s.bind(target);
    s.db.sqlite.prepare('UPDATE native_binding_groups SET enabled=0 WHERE binding_id=?').run(binding.id);
    expect(() => s.db.sqlite.prepare("UPDATE native_binding_groups SET allowed_sender_refs_json='[\"another-sender\"]' WHERE binding_id=?").run(binding.id)).toThrow('new revision');
    expect(() => s.bind(target, [s.b], s.second)).toThrow('does not isolate');
    expect(() => s.repository.replaceVersion({ ownerUserId: s.owner, bindingId: binding.id, expectedRevision: 1, targetId: target, groupIds: [s.b] })).toThrow('does not isolate');
    expect(s.repository.findBinding(s.owner, binding.id)?.revision).toBe(1);
    expect(() => s.bind(s.target('unsupported'), [s.b], s.second)).toThrow('does not isolate');
    const isolated = s.target(); s.bind(isolated, [s.a, s.b], s.second);
    expect(() => s.db.sqlite.prepare("UPDATE native_runtime_targets SET context_mode='shared_bot_context' WHERE id=?").run(isolated)).toThrow('incompatible');
  });
  it('does not turn malformed capability values or arbitrary stored fields into a verified descriptor', () => {
    const s = setup(); const target = s.target();
    s.db.sqlite.prepare('UPDATE native_runtime_targets SET capabilities_json=? WHERE id=?')
      .run(JSON.stringify({ approvals: ['verified'] }), target);
    expect(() => s.repository.findTarget(s.owner, target)).toThrow('Invalid native capability status');
    s.db.sqlite.prepare('UPDATE native_runtime_targets SET capabilities_json=? WHERE id=?')
      .run(JSON.stringify({ approvals: 'unsupported', arbitraryPrivateField: 'synthetic-private-field' }), target);
    const descriptor = s.repository.findTarget(s.owner, target)!;
    expect(descriptor.capabilities.approvals).toBe('unsupported');
    expect(JSON.stringify(descriptor)).not.toContain('synthetic-private-field');
  });
  it('uses immutable versions and atomic compare-and-swap; a failed rebind leaves no partial version', () => {
    const s = setup(); const target = s.target(); const binding = s.bind(target);
    s.db.sqlite.prepare('UPDATE native_conversations SET native_ref=? WHERE binding_id=?').run('native-thread', binding.id);
    const next = s.repository.replaceVersion({ ownerUserId: s.owner, bindingId: binding.id, expectedRevision: 1, targetId: target, groupIds: [s.a, s.b] });
    expect(next.revision).toBe(2); expect(next.enabled).toBe(false);
    expect(s.db.sqlite.prepare('SELECT native_ref FROM native_conversations WHERE binding_id=? AND revision=2 AND group_id=?').get(binding.id, s.a)).toEqual({ native_ref: 'native-thread' });
    expect(() => s.repository.replaceVersion({ ownerUserId: s.owner, bindingId: binding.id, expectedRevision: 1, targetId: target, groupIds: [] })).toThrow('conflict');
    expect(() => s.repository.replaceVersion({ ownerUserId: s.owner, bindingId: binding.id, expectedRevision: 2, targetId: s.target('native_per_group', s.otherOwner), groupIds: [s.a] })).toThrow();
    expect(s.repository.findBinding(s.owner, binding.id)?.revision).toBe(2);
    expect(s.db.sqlite.prepare('SELECT count(*) AS n FROM native_binding_versions WHERE binding_id=?').get(binding.id)).toEqual({ n: 2 });
    expect(() => s.db.sqlite.prepare('UPDATE native_binding_versions SET target_id=? WHERE binding_id=?').run(target, binding.id)).toThrow('immutable');
  });
  it('ties deliveries to the original inbox identity and enforces one active slot per target across bindings', () => {
    const s = setup(); const target = s.target(); const one = s.bind(target); const two = s.bind(target, [s.b], s.second);
    const eventOne = s.event(); const eventTwo = s.event(s.second, s.b);
    const insert = (eventId: string, agent: string, group: string, binding: string, claim: string) => s.db.sqlite.prepare(`
      INSERT INTO native_deliveries(event_id,agent_id,group_id,binding_id,binding_revision,target_id,claim,state,created_at)
      VALUES(?,?,?,?,1,?,?,'running',0)`).run(eventId, agent, group, binding, target, claim);
    expect(() => insert(eventOne, s.second, s.b, two.id, 'wrong')).toThrow();
    insert(eventOne, s.agent, s.a, one.id, 'claim-one');
    expect(() => insert(eventTwo, s.second, s.b, two.id, 'claim-two')).toThrow();
    expect(() => s.repository.replaceVersion({ ownerUserId: s.owner, bindingId: one.id, expectedRevision: 1, targetId: s.target(), groupIds: [s.a] })).toThrow('unconfirmed');
    s.db.sqlite.prepare("UPDATE native_deliveries SET state='done' WHERE event_id=?").run(eventOne);
    insert(eventTwo, s.second, s.b, two.id, 'claim-two');
  });
  it('restores the last compatible conversation when a group is removed and later reintroduced', () => {
    const s = setup(); const target = s.target(); const binding = s.bind(target, [s.a, s.b]);
    s.db.sqlite.prepare('UPDATE native_conversations SET generation=4,native_ref=? WHERE binding_id=? AND group_id=?')
      .run('group-a-thread', binding.id, s.a);
    s.repository.replaceVersion({ ownerUserId: s.owner, bindingId: binding.id, expectedRevision: 1, targetId: target, groupIds: [s.b] });
    s.repository.replaceVersion({ ownerUserId: s.owner, bindingId: binding.id, expectedRevision: 2, targetId: target, groupIds: [s.a, s.b] });
    expect(s.db.sqlite.prepare('SELECT generation,native_ref FROM native_conversations WHERE binding_id=? AND revision=3 AND group_id=?')
      .get(binding.id, s.a)).toEqual({ generation: 4, native_ref: 'group-a-thread' });
  });
  it('never copies another target conversation when switching away and back', () => {
    const s = setup(); const first = s.target(); const second = s.target(); const binding = s.bind(first);
    s.db.sqlite.prepare('UPDATE native_conversations SET generation=4,native_ref=? WHERE binding_id=?').run('first-target-thread', binding.id);
    s.repository.replaceVersion({ ownerUserId: s.owner, bindingId: binding.id, expectedRevision: 1, targetId: second, groupIds: [s.a] });
    expect(s.db.sqlite.prepare('SELECT generation,native_ref FROM native_conversations WHERE binding_id=? AND revision=2')
      .get(binding.id)).toEqual({ generation: 1, native_ref: null });
    s.db.sqlite.prepare('UPDATE native_conversations SET native_ref=? WHERE binding_id=? AND revision=2').run('second-target-thread', binding.id);
    s.repository.replaceVersion({ ownerUserId: s.owner, bindingId: binding.id, expectedRevision: 2, targetId: first, groupIds: [s.a] });
    expect(s.db.sqlite.prepare('SELECT generation,native_ref FROM native_conversations WHERE binding_id=? AND revision=3')
      .get(binding.id)).toEqual({ generation: 4, native_ref: 'first-target-thread' });
  });
  it('rejects ambiguous historical references atomically rather than choosing a new context', () => {
    const s = setup(); const target = s.target(); const binding = s.bind(target);
    s.db.sqlite.prepare('UPDATE native_conversations SET native_ref=? WHERE binding_id=?').run('original', binding.id);
    s.repository.replaceVersion({ ownerUserId: s.owner, bindingId: binding.id, expectedRevision: 1, targetId: target, groupIds: [s.a] });
    s.db.sqlite.prepare('UPDATE native_conversations SET native_ref=? WHERE binding_id=? AND revision=2').run('conflicting', binding.id);
    expect(() => s.repository.replaceVersion({ ownerUserId: s.owner, bindingId: binding.id, expectedRevision: 2, targetId: target, groupIds: [s.a] })).toThrow('ambiguous');
    expect(s.repository.findBinding(s.owner, binding.id)?.revision).toBe(2);
    expect(s.db.sqlite.prepare('SELECT count(*) AS n FROM native_binding_versions WHERE binding_id=?').get(binding.id)).toEqual({ n: 2 });
  });
  it('keeps an explicit new conversation generation instead of resurrecting the previous one', () => {
    const s = setup(); const target = s.target(); const binding = s.bind(target);
    s.db.sqlite.prepare('UPDATE native_conversations SET native_ref=? WHERE binding_id=?').run('old-conversation', binding.id);
    s.db.sqlite.prepare('INSERT INTO native_conversations(binding_id,revision,group_id,generation) VALUES(?,1,?,2)').run(binding.id, s.a);
    s.repository.replaceVersion({ ownerUserId: s.owner, bindingId: binding.id, expectedRevision: 1, targetId: target, groupIds: [s.a] });
    expect(s.db.sqlite.prepare('SELECT generation,native_ref FROM native_conversations WHERE binding_id=? AND revision=2').get(binding.id))
      .toEqual({ generation: 2, native_ref: null });
  });
  it('migrates the legacy binding and conversation passively without changing pending jobs or ACKs', () => {
    const s = setup(true); const eventId = s.event();
    s.db.sqlite.prepare("INSERT INTO oauth_clients(client_id,client_name,redirect_uris) VALUES('client','Fixture','[]')").run();
    s.db.sqlite.prepare("INSERT INTO agent_connections(id,agent_id,oauth_client_id,scopes) VALUES('connection',?,'client','[]')").run(s.agent);
    s.db.sqlite.prepare("INSERT INTO agent_automation_bindings(agent_id,group_id,enabled,model,thread_id) VALUES(?,?,1,'gpt-6.1-sol','legacy-thread')").run(s.agent, s.a);
    s.db.sqlite.prepare("INSERT INTO agent_automation_jobs(event_id,agent_id,group_id,connection_id,instance_id,claim,state,created_at,started) VALUES(?,?,?,'connection','instance','legacy-claim','running',0,1)").run(eventId, s.agent, s.a);
    const before = s.db.sqlite.prepare('SELECT * FROM agent_automation_jobs').all();
    applyMigrations(s.db.sqlite, s.migrations);
    expect(s.repository.findBinding(s.owner, s.agent)).toMatchObject({ legacyProjection: true, enabled: false, targetId: s.agent });
    expect(s.db.sqlite.prepare('SELECT native_ref FROM native_conversations').get()).toEqual({ native_ref: 'legacy-thread' });
    expect(s.db.sqlite.prepare('SELECT * FROM agent_automation_jobs').all()).toEqual(before);
    expect(s.db.sqlite.prepare('SELECT acknowledged_at FROM inbox_events').get()).toEqual({ acknowledged_at: null });
    expect(s.db.sqlite.prepare('SELECT count(*) AS n FROM native_deliveries').get()).toEqual({ n: 0 });
    expect(s.db.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
