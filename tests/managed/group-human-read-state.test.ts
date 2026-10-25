import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { ManagedDatabase } from '../../apps/server/src/managed/database';
import { createManagedServices } from '../../apps/server/src/managed/services';

// Parent runs this after applying additive migrations to disposable local Supabase.
// Never resets a database, calls cloud endpoints, or touches existing identities.
const url = process.env['DATABASE_URL'];
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Human-read tests require disposable local Supabase');
const db = new ManagedDatabase(url);
afterAll(async () => { await db.close(); });
async function fixture() {
  const services = createManagedServices(db, { url: process.env['SUPABASE_URL']!, anonKey: process.env['SUPABASE_ANON_KEY']!, publicOrigin: 'http://127.0.0.1:4319' });
  const person = (name: string) => services.identity.createUser({ email: `human-read-${name}-${randomUUID()}@example.com`, displayName: name, passwordHash: 'external' });
  const ada = await person('Ada'); const grace = await person('Grace'); const outsider = await person('Outside');
  const { group } = await services.groups.createGroup({ userId: ada.id, name: 'Human read fixture' });
  const token = (await services.groups.createInvitation({ userId: ada.id, groupId: group.id })).token;
  await services.groups.acceptInvitation({ userId: grace.id, token });
  const send = (text: string, userId = ada.id, groupId = group.id) => services.messaging.send({ author: { kind: 'human', id: userId }, groupId, text, idempotencyKey: randomUUID() });
  const read = (messageIds: string[], userId = grace.id, groupId = group.id) => services.groups.markMessagesRead({ userId, groupId, messageIds });
  const activity = async () => (await services.groups.listGroups(grace.id))[0]?.activity;
  return { services, ada, grace, outsider, group, send, read, activity };
}
it('durably reads exact messages, preserves gaps, own-send semantics and monotonic cursor under concurrent updates', async () => {
  const f = await fixture();
  const one = (await f.send('one')).message; const two = (await f.send('two')).message;
  await f.send('own', f.grace.id);
  expect(await f.activity()).toMatchObject({ unreadCount: 2, latestSequence: 3, readSequence: 0 });
  await f.read([two.id]);
  expect(await f.activity()).toMatchObject({ unreadCount: 1, readSequence: 2 });
  await Promise.all([f.read([one.id]), f.read([two.id, two.id])]);
  expect(await f.activity()).toMatchObject({ unreadCount: 0, readSequence: 2 });
  await f.send('unloaded');
  expect(await f.activity()).toMatchObject({ unreadCount: 1, latestSequence: 4, readSequence: 2 });
  const second = new ManagedDatabase(url!);
  try {
    const stored = await second.one<{ read_sequence: string }>('SELECT read_sequence FROM group_human_memberships WHERE group_id=$1 AND user_id=$2', [f.group.id, f.grace.id]);
    expect(Number(stored?.read_sequence)).toBe(2);
  } finally { await second.close(); }
  await expect(db.rows('UPDATE group_human_memberships SET read_sequence=0 WHERE group_id=$1 AND user_id=$2', [f.group.id, f.grace.id])).rejects.toThrow(/cannot decrease/);
});
it('enforces membership, exact IDs, bounds and private SQL access without partial writes', async () => {
  const f = await fixture(); const one = (await f.send('private')).message;
  await expect(f.read([one.id], f.outsider.id)).rejects.toMatchObject({ code: 'not_found' });
  await expect(f.read([one.id, 'not-delivered-future-id'])).rejects.toMatchObject({ code: 'not_found' });
  await expect(f.read([])).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(f.read(Array(101).fill(one.id))).rejects.toMatchObject({ code: 'invalid_input' });
  expect(await f.activity()).toMatchObject({ unreadCount: 1, readSequence: 0 });
  const other = (await f.services.groups.createGroup({ userId: f.ada.id, name: 'Other private' })).group;
  const foreign = (await f.send('foreign', f.ada.id, other.id)).message;
  await expect(f.read([one.id, foreign.id])).rejects.toMatchObject({ code: 'not_found' });
  await expect(db.rows('INSERT INTO group_human_message_reads(group_id,user_id,message_id) VALUES($1,$2,$3)', [f.group.id, f.grace.id, foreign.id])).rejects.toThrow(/outside group/);
  for (const role of ['anon', 'authenticated']) await expect(db.transaction(async () => {
    await db.rows(`SET LOCAL ROLE ${role}`); await db.rows('SELECT * FROM agent_chat.group_human_message_reads');
  })).rejects.toMatchObject({ code: '42501' });
});
it('cascades reads on removal/rejoin and keeps agent inbox acknowledgements independent', async () => {
  const f = await fixture();
  const agent = await f.services.agents.createAgent({ ownerUserId: f.ada.id, name: 'Human read fixture agent' });
  await f.services.groups.admitAgent({ userId: f.ada.id, groupId: f.group.id, agentId: agent.id });
  const one = (await f.send('pending')).message;
  const before = await f.services.inbox.listPending({ agentId: agent.id }); expect(before.events).toHaveLength(1);
  await f.read([one.id]);
  expect(await f.services.inbox.listPending({ agentId: agent.id })).toEqual(before);
  await f.services.groups.removeHumanMember({ userId: f.ada.id, groupId: f.group.id, memberId: f.grace.id });
  expect(await db.rows('SELECT * FROM group_human_message_reads WHERE group_id=$1 AND user_id=$2', [f.group.id, f.grace.id])).toEqual([]);
  await expect(f.read([one.id])).rejects.toMatchObject({ code: 'not_found' });
  const token = (await f.services.groups.createInvitation({ userId: f.ada.id, groupId: f.group.id })).token;
  await f.services.groups.acceptInvitation({ userId: f.grace.id, token });
  await f.services.inbox.acknowledge({ agentId: agent.id, eventId: before.events[0]!.eventId });
  expect(await f.activity()).toMatchObject({ unreadCount: 1, readSequence: 0 });
});
