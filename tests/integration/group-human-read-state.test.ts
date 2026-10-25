import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { GROUP_PATHS, type GroupSummary } from '@agent-chat/contracts';
import { createApp } from '../../apps/server/src/app';
import { readConfig } from '../../apps/server/src/config/env';
import { REPOSITORY_ROOT } from '../../apps/server/src/config/index';
import { createDatabase } from '../../apps/server/src/persistence/client';
import { migrateFromDirectory } from '../../apps/server/src/persistence/migrate';
import { createServices } from '../../apps/server/src/services';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
const origin = 'http://127.0.0.1:4318';
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'group-human-read-'));
  const path = join(directory, 'data.db');
  mkdirSync(join(directory, 'web/assets'), { recursive: true });
  writeFileSync(join(directory, 'web/index.html'), '<div id="root"></div>');
  const database = createDatabase({ path, busyTimeoutMs: 1000 });
  migrateFromDirectory(database.sqlite, join(REPOSITORY_ROOT, 'db/migrations'));
  const services = createServices(database);
  const app = await createApp({ database, services, config: readConfig({ repoRoot: REPOSITORY_ROOT, env: {
    NODE_ENV: 'test', LOG_LEVEL: 'silent', WEB_DIST_DIR: join(directory, 'web'),
  } }) });
  await app.ready();
  cleanups.push(async () => { await app.close(); database.close(); rmSync(directory, { recursive: true, force: true }); });
  async function person(name: string) {
    const result = await services.auth.register({ email: `${name}@read-test.example`, displayName: name, password: 'fixture-long-password' });
    return { ...result.user, cookie: `agent_chat_session=${result.sessionToken}` };
  }
  const ada = await person('Ada'); const grace = await person('Grace'); const outsider = await person('Outside');
  const { group } = services.groups.createGroup({ userId: ada.id, name: 'Lecturas' });
  const token = services.groups.createInvitation({ userId: ada.id, groupId: group.id }).token;
  services.groups.acceptInvitation({ userId: grace.id, token });
  const send = (userId: string, text: string, groupId = group.id) => services.messaging.send({ groupId, author: { kind: 'human', id: userId }, text, idempotencyKey: text });
  const list = async (cookie: string) => (await app.inject({ url: GROUP_PATHS.collection, headers: { cookie } })).json().groups as GroupSummary[];
  const read = (cookie: string, ids: string[], groupId = group.id, requestOrigin = origin) => app.inject({
    method: 'POST', url: GROUP_PATHS.read(groupId), headers: { cookie, origin: requestOrigin, host: '127.0.0.1:4318' }, payload: { messageIds: ids },
  });
  return { app, services, database, path, ada, grace, outsider, group, send, read, list };
}

it('stores only exact displayed messages, keeps gaps/newer messages unread and survives reopening SQLite', async () => {
  const f = await fixture();
  const messages = ['one', 'two', 'three'].map(text => f.send(f.ada.id, text).message);
  f.send(f.grace.id, 'own');
  expect((await f.list(f.grace.cookie))[0]?.activity).toMatchObject({ latestSequence: 4, unreadCount: 3, readSequence: 0 });
  expect((await f.read(f.grace.cookie, [messages[2]!.id, messages[2]!.id])).statusCode).toBe(200);
  expect((await f.list(f.grace.cookie))[0]?.activity).toMatchObject({ unreadCount: 2, readSequence: 3 });
  expect((await f.read(f.grace.cookie, [messages[0]!.id])).statusCode).toBe(200);
  expect((await f.list(f.grace.cookie))[0]?.activity).toMatchObject({ unreadCount: 1, readSequence: 3 });
  f.send(f.ada.id, 'newer-unloaded');
  const reopened = createDatabase({ path: f.path, busyTimeoutMs: 1000 });
  try {
    const durable = createServices(reopened).groups.listGroups(f.grace.id)[0];
    expect(durable?.activity).toMatchObject({ latestSequence: 5, unreadCount: 2, readSequence: 3 });
  } finally { reopened.close(); }
  expect((await f.list(f.ada.cookie))[0]?.activity?.unreadCount).toBe(1);
});

it('requires a human session, membership, same-group exact IDs and existing messages, atomically', async () => {
  const f = await fixture(); const message = f.send(f.ada.id, 'private-content').message;
  expect((await f.read('', [message.id])).statusCode).toBe(401);
  const denied = await f.read(f.outsider.cookie, [message.id]);
  const absent = await f.read(f.outsider.cookie, [message.id], 'unknown');
  expect(denied.statusCode).toBe(404); expect(denied.json()).toEqual(absent.json());
  expect(JSON.stringify(denied.json())).not.toContain('private-content');
  const other = f.services.groups.createGroup({ userId: f.ada.id, name: 'Otro' }).group;
  const foreign = f.send(f.ada.id, 'foreign', other.id).message;
  for (const ids of [[message.id, foreign.id], [message.id, 'future-id']]) {
    expect((await f.read(f.grace.cookie, ids)).statusCode).toBe(404);
    expect((await f.list(f.grace.cookie))[0]?.activity?.unreadCount).toBe(1);
  }
  expect((await f.read(f.grace.cookie, [message.id], f.group.id, 'https://other.example')).statusCode).toBe(403);
  for (const ids of [[], Array(101).fill(message.id)]) expect((await f.read(f.grace.cookie, ids)).statusCode).toBe(400);
  expect((await f.read(f.grace.cookie, [message.id])).statusCode).toBe(200);
  expect(() => f.database.sqlite.prepare('UPDATE group_human_memberships SET read_sequence=0 WHERE group_id=? AND user_id=?').run(f.group.id, f.grace.id)).toThrow(/cannot decrease/);
  expect(() => f.database.sqlite.prepare('INSERT INTO group_human_message_reads(group_id,user_id,message_id) VALUES(?,?,?)').run(f.group.id, f.grace.id, foreign.id)).toThrow(/outside group/);
});

it('clears read state on removal; rejoining starts a fresh membership with history pending', async () => {
  const f = await fixture(); const message = f.send(f.ada.id, 'history').message;
  await f.read(f.grace.cookie, [message.id]);
  f.services.groups.removeHumanMember({ userId: f.ada.id, groupId: f.group.id, memberId: f.grace.id });
  expect(await f.list(f.grace.cookie)).toEqual([]);
  expect((await f.read(f.grace.cookie, [message.id])).statusCode).toBe(404);
  expect(f.database.sqlite.prepare('SELECT * FROM group_human_message_reads WHERE user_id=?').all(f.grace.id)).toEqual([]);
  const token = f.services.groups.createInvitation({ userId: f.ada.id, groupId: f.group.id }).token;
  f.services.groups.acceptInvitation({ userId: f.grace.id, token });
  expect((await f.list(f.grace.cookie))[0]?.activity).toMatchObject({ readSequence: 0, unreadCount: 1 });
});

it('never acknowledges agent inbox and preserves the original group-list ordering', async () => {
  const f = await fixture();
  const agent = f.services.agents.createAgent({ ownerUserId: f.ada.id, name: 'Fixture' });
  f.services.groups.admitAgent({ userId: f.ada.id, groupId: f.group.id, agentId: agent.id });
  const other = f.services.groups.createGroup({ userId: f.ada.id, name: 'Segundo' }).group;
  const message = f.send(f.ada.id, 'agent-pending').message;
  const before = f.services.inbox.listPending({ agentId: agent.id });
  expect(before.events).toHaveLength(1);
  await f.read(f.grace.cookie, [message.id]);
  expect(f.services.inbox.listPending({ agentId: agent.id })).toEqual(before);
  f.services.inbox.acknowledge({ agentId: agent.id, eventId: before.events[0]!.eventId });
  expect((await f.list(f.grace.cookie))[0]?.activity?.unreadCount).toBe(0);
  const second = f.send(f.ada.id, 'another-agent-pending').message;
  const event = f.services.inbox.eventForMessage(agent.id, second.id)!;
  f.services.inbox.acknowledge({ agentId: agent.id, eventId: event.eventId });
  expect((await f.list(f.grace.cookie))[0]?.activity?.unreadCount).toBe(1);
  f.send(f.ada.id, 'latest-other', other.id);
  expect((await f.list(f.ada.cookie)).map(g => g.id)).toEqual([f.group.id, other.id]);
});
