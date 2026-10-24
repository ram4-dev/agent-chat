import { describe, expect, it } from 'vitest';
import { GROUP_PATHS, MESSAGE_PATHS } from '@agent-chat/contracts';
import { startHarness, agentToken, ownerWithAgent, connect, call } from '../helpers/agent-harness';

describe('MCP tool surface', () => {
  it('refuses an unauthenticated caller with the stable domain code', async () => {
    const harness = await startHarness();

    // The handshake itself is the first tool-like request, so that is where the
    // refusal surfaces. It names no reason: expired, forged, and missing
    // credentials all read the same.
    await expect(connect(undefined, harness)).rejects.toThrow('unauthenticated');
  });

  it('advertises messaging and owner-run receiver tools to an authenticated agent', async () => {
    const harness = await startHarness();
    const { token } = await agentToken(harness, 'tools-owner@example.com', 'Roster');

    const { client, close } = await connect(token, harness);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        'ack_inbox',
        'configure_runtime',
        'confirm_notification_delivery',
        'get_agent_instructions',
        'get_identity',
        'get_inbox',
        'get_notification_status',
        'list_groups',
        'pair_native',
        'read_messages',
        'runtime_begin',
        'runtime_fail',
        'runtime_finish',
        'runtime_next',
        'runtime_open',
        'runtime_save',
        'send_message',
        'setup_notifications',
      ]);
    } finally {
      await close();
    }
  });

  it('delivers the participation guide through initialization, tools and resources without credentials', async () => {
    const harness = await startHarness();
    const { token } = await agentToken(harness, 'guide-owner@example.com', 'Guide reader');
    const { client, close } = await connect(token, harness);
    try {
      expect(client.getInstructions()).toContain('get_agent_instructions');
      const resources = await client.listResources();
      const guide = resources.resources.find((resource) => resource.uri === 'agent-chat://guides/participation');
      expect(guide?.mimeType).toBe('text/markdown');
      const document = await client.readResource({ uri: guide!.uri });
      const result = await client.callTool({ name: 'get_agent_instructions', arguments: {} });
      expect(result.isError).toBeUndefined();
      const body = JSON.parse(String((result.content as Array<{ text: string }>)[0]?.text));
      const content = document.contents[0];
      expect(body.instructions).toEqual(expect.any(String));
      expect(body.instructions).toBe(content && 'text' in content ? content.text : undefined);
      expect(body.receiver.url).toBe(`${harness.origin.replace(/^http/, 'ws')}/ws/agent`);
      expect(body.mcp_url).toBe(`${harness.origin}/mcp`);
      expect(body.granted_scopes).toContain('agent:receive');
      expect(JSON.stringify(result)).not.toContain(token);
      expect(JSON.stringify(document)).not.toContain(token);
    } finally {
      await close();
    }
  });

  it('answers an agent credential with its identity, owner, and granted scopes', async () => {
    const harness = await startHarness();
    const { token } = await agentToken(harness, 'mcp-owner@example.com', 'Scout');

    const { client, close } = await connect(token, harness);
    try {
      const result = await client.callTool({ name: 'get_identity', arguments: {} });
      const payload = JSON.parse(String((result.content as Array<{ text: string }>)[0]?.text)) as {
        agent: { id: string; name: string };
        owner: { email: string } | null;
        connection: { scopes: string[] };
      };

      expect(payload.agent.name).toBe('Scout');
      expect(payload.owner?.email).toBe('mcp-owner@example.com');
      // The credential reports what it may do, so a client never has to guess.
      expect(payload.connection.scopes).toEqual(
        expect.arrayContaining(['agent:read', 'agent:send', 'agent:inbox', 'agent:receive']),
      );
    } finally {
      await close();
    }
  });

  it('scopes read and send to groups the agent belongs to', async () => {
    const harness = await startHarness();
    const { token, jar } = await agentToken(harness, 'chat-owner@example.com', 'Scribe');

    const agent = harness.database.sqlite
      .prepare('SELECT id FROM agents LIMIT 1')
      .get() as { id: string };

    // The group is created and the agent admitted through the product's own
    // routes: no membership is seeded by hand.
    const created = await call(harness, jar, {
      method: 'POST',
      url: GROUP_PATHS.collection,
      payload: { name: 'Research' },
    });
    expect(created.statusCode).toBe(201);
    const groupId = JSON.parse(created.body).group.id as string;

    const admitted = await call(harness, jar, {
      method: 'POST',
      url: GROUP_PATHS.agentMember(groupId, agent.id),
    });
    expect([200, 201]).toContain(admitted.statusCode);

    const { client, close } = await connect(token, harness);
    try {
      const listed = await client.callTool({ name: 'list_groups', arguments: {} });
      const groups = JSON.parse(String((listed.content as Array<{ text: string }>)[0]?.text)) as {
        groups: Array<{ id: string; role: string }>;
      };
      expect(groups.groups.map((group) => [group.id, group.role])).toEqual([[groupId, 'member']]);

      const missing = await client.callTool({
        name: 'send_message',
        arguments: { group_id: 'not-a-member', text: 'nope', idempotency_key: 'k1' },
      });
      expect(missing.isError).toBe(true);
      expect(String((missing.content as Array<{ text: string }>)[0]?.text)).toBe('not_found');

      const sent = await client.callTool({
        name: 'send_message',
        arguments: { group_id: groupId, text: 'An update from the agent', idempotency_key: 'k1' },
      });
      expect(sent.isError).toBeUndefined();
      const message = JSON.parse(String((sent.content as Array<{ text: string }>)[0]?.text)) as {
        message: { text: string; author: { kind: string } };
      };
      expect(message.message.text).toBe('An update from the agent');
      expect(message.message.author.kind).toBe('agent');

      // Retrying the same key returns the same message, not a second one.
      const retry = await client.callTool({
        name: 'send_message',
        arguments: { group_id: groupId, text: 'An update from the agent', idempotency_key: 'k1' },
      });
      const retried = JSON.parse(String((retry.content as Array<{ text: string }>)[0]?.text)) as {
        replayed: boolean;
      };
      expect(retried.replayed).toBe(true);

      const stored = harness.database.sqlite
        .prepare('SELECT COUNT(*) AS total FROM messages')
        .get() as { total: number };
      expect(stored.total).toBe(1);

      const read = await client.callTool({
        name: 'read_messages',
        arguments: { group_id: groupId },
      });
      const page = JSON.parse(String((read.content as Array<{ text: string }>)[0]?.text)) as {
        messages: Array<{ text: string }>;
      };
      expect(page.messages[0]?.text).toBe('An update from the agent');
    } finally {
      await close();
    }
  });
});

describe('admitting an agent to a private group', () => {
  it('lets a group admin admit an agent and refuses a plain member and an outsider', async () => {
    const harness = await startHarness();
    const { jar: admin, agentId } = await ownerWithAgent(harness, 'admin@example.com', 'Scout');
    const { jar: member } = await ownerWithAgent(harness, 'member@example.com', 'Member');
    const { jar: outsider } = await ownerWithAgent(harness, 'outsider@example.com', 'Outsider');

    const created = await call(harness, admin, {
      method: 'POST',
      url: GROUP_PATHS.collection,
      payload: { name: 'Private' },
    });
    const groupId = JSON.parse(created.body).group.id as string;

    // A person outside the group is told nothing about it.
    const fromOutsider = await call(harness, outsider, {
      method: 'POST',
      url: GROUP_PATHS.agentMember(groupId, agentId),
    });
    expect(fromOutsider.statusCode).toBe(404);
    expect(fromOutsider.json()).toEqual({ error: { code: 'not_found' } });

    const admitted = await call(harness, admin, {
      method: 'POST',
      url: GROUP_PATHS.agentMember(groupId, agentId),
    });
    expect(admitted.statusCode).toBe(201);

    const detail = await call(harness, admin, { method: 'GET', url: GROUP_PATHS.one(groupId) });
    const members = (detail.json().members ?? []) as Array<{ kind: string; displayName: string }>;
    expect(members.filter((m) => m.kind === 'agent').map((m) => m.displayName)).toEqual(['Scout']);

    // Joining twice adds nothing.
    const again = await call(harness, admin, {
      method: 'POST',
      url: GROUP_PATHS.agentMember(groupId, agentId),
    });
    expect(again.statusCode).toBe(200);

    // A member of the group who is not its admin cannot admit anyone.
    const invited = await call(harness, admin, {
      method: 'POST',
      url: GROUP_PATHS.invitations(groupId),
    });
    const accepted = await call(harness, member, {
      method: 'POST',
      url: GROUP_PATHS.acceptInvitation,
      payload: { token: JSON.parse(invited.body).token },
    });
    expect(accepted.statusCode).toBe(200);

    const fromMember = await call(harness, member, {
      method: 'POST',
      url: GROUP_PATHS.agentMember(groupId, agentId),
    });
    expect(fromMember.statusCode).toBe(403);
    expect(fromMember.json()).toEqual({ error: { code: 'forbidden' } });
  });

  it('refuses an agent that does not exist or is revoked', async () => {
    const harness = await startHarness();
    const { jar, agentId } = await ownerWithAgent(harness, 'revoker@example.com', 'Scout');

    const created = await call(harness, jar, {
      method: 'POST',
      url: GROUP_PATHS.collection,
      payload: { name: 'Private' },
    });
    const groupId = JSON.parse(created.body).group.id as string;

    const unknown = await call(harness, jar, {
      method: 'POST',
      url: GROUP_PATHS.agentMember(groupId, 'no-such-agent'),
    });
    expect(unknown.statusCode).toBe(404);

    harness.database.sqlite
      .prepare(`UPDATE agents SET status = 'revoked', revoked_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), agentId);

    const revoked = await call(harness, jar, {
      method: 'POST',
      url: GROUP_PATHS.agentMember(groupId, agentId),
    });
    expect(revoked.statusCode).toBe(404);
    expect(revoked.json()).toEqual({ error: { code: 'not_found' } });
  });
});

describe('durable inbox', () => {
  interface InboxEvent {
    event_id?: never;
    eventId: string;
    sequence: number;
    groupId: string;
    message: { text: string; author: { kind: string; displayName: string } };
  }

  /** Reads the pending events an agent currently sees. */
  async function readInbox(client: Awaited<ReturnType<typeof connect>>['client']) {
    const result = await client.callTool({ name: 'get_inbox', arguments: {} });
    const payload = JSON.parse(String((result.content as Array<{ text: string }>)[0]?.text)) as {
      events: InboxEvent[];
      nextCursor?: number;
    };
    return payload;
  }

  it('keeps an event pending until acknowledged, and history never acknowledges it', async () => {
    const harness = await startHarness();
    const { token, jar, agentId } = await ownerWithAgent(
      harness,
      'inbox-owner@example.com',
      'Scribe',
    );

    const created = await call(harness, jar, {
      method: 'POST',
      url: GROUP_PATHS.collection,
      payload: { name: 'Announcements' },
    });
    const groupId = JSON.parse(created.body).group.id as string;
    await call(harness, jar, {
      method: 'POST',
      url: GROUP_PATHS.agentMember(groupId, agentId),
    });

    // A person posts while the agent is not listening: nothing reaches a runtime,
    // but nothing is lost either.
    const posted = await call(harness, jar, {
      method: 'POST',
      url: MESSAGE_PATHS.collection(groupId),
      payload: { text: 'A note while nobody is listening', idempotencyKey: 'note-1' },
    });
    expect(posted.statusCode).toBe(201);

    const { client, close } = await connect(token, harness);
    try {
      // AC10: the event is pending and readable after reconnecting.
      const first = await readInbox(client);
      expect(first.events).toHaveLength(1);
      expect(first.events[0]?.message.text).toBe('A note while nobody is listening');
      expect(first.events[0]?.groupId).toBe(groupId);
      expect(first.events[0]?.sequence).toEqual(expect.any(Number));

      // Still pending on a later read: retrieval alone never consumes it.
      const reread = await readInbox(client);
      expect(reread.events).toHaveLength(1);

      // AC11: reading message history does not acknowledge the event.
      await client.callTool({ name: 'read_messages', arguments: { group_id: groupId } });
      const afterHistory = await readInbox(client);
      expect(afterHistory.events).toHaveLength(1);

      // Acknowledging clears pending state, exactly once.
      const eventId = first.events[0]!.eventId;
      await client.callTool({ name: 'ack_inbox', arguments: { event_id: eventId } });
      const cleared = await readInbox(client);
      expect(cleared.events).toEqual([]);

      // Repeating the acknowledgement is safe rather than an error.
      const repeat = await client.callTool({ name: 'ack_inbox', arguments: { event_id: eventId } });
      expect(repeat.isError).toBeUndefined();
      expect((await readInbox(client)).events).toEqual([]);
    } finally {
      await close();
    }
  });

  it('notifies every other agent in the group and never its own author', async () => {
    const harness = await startHarness();
    const { token: authorToken, jar: authorJar, agentId: authorId } = await ownerWithAgent(
      harness,
      'author-owner@example.com',
      'Author',
    );
    const { token: listenerToken, agentId: listenerId } = await ownerWithAgent(
      harness,
      'listener-owner@example.com',
      'Listener',
    );

    const created = await call(harness, authorJar, {
      method: 'POST',
      url: GROUP_PATHS.collection,
      payload: { name: 'Shared' },
    });
    const groupId = JSON.parse(created.body).group.id as string;
    for (const agentId of [authorId, listenerId]) {
      const admitted = await call(harness, authorJar, {
        method: 'POST',
        url: GROUP_PATHS.agentMember(groupId, agentId),
      });
      expect([200, 201]).toContain(admitted.statusCode);
    }

    const author = await connect(authorToken, harness);
    const listener = await connect(listenerToken, harness);
    try {
      await author.client.callTool({
        name: 'send_message',
        arguments: { group_id: groupId, text: 'From the author', idempotency_key: 'fan-1' },
      });

      // The other agent is notified of a message it did not write.
      const listenerEvents = await readInbox(listener.client);
      expect(listenerEvents.events).toHaveLength(1);
      expect(listenerEvents.events[0]?.message.text).toBe('From the author');
      expect(listenerEvents.events[0]?.message.author.displayName).toBe('Author');

      // An agent is never told about its own message.
      expect((await readInbox(author.client)).events).toEqual([]);
    } finally {
      await author.close();
      await listener.close();
    }
  });

  it('refuses to disclose an event whose group the agent has left', async () => {
    const harness = await startHarness();
    const { token, jar, agentId } = await ownerWithAgent(
      harness,
      'leaver-owner@example.com',
      'Leaver',
    );

    const created = await call(harness, jar, {
      method: 'POST',
      url: GROUP_PATHS.collection,
      payload: { name: 'Temporary' },
    });
    const groupId = JSON.parse(created.body).group.id as string;
    await call(harness, jar, {
      method: 'POST',
      url: GROUP_PATHS.agentMember(groupId, agentId),
    });
    await call(harness, jar, {
      method: 'POST',
      url: MESSAGE_PATHS.collection(groupId),
      payload: { text: 'Private note', idempotencyKey: 'leave-1' },
    });

    const { client, close } = await connect(token, harness);
    try {
      expect((await readInbox(client)).events).toHaveLength(1);

      // The agent is removed from the group.
      const removed = await call(harness, jar, {
        method: 'DELETE',
        url: GROUP_PATHS.agentMember(groupId, agentId),
      });
      expect(removed.statusCode).toBe(200);

      // The event still exists, but confirming it would reveal that the group
      // holds messages the agent can no longer reach.
      expect((await readInbox(client)).events).toEqual([]);

      const eventId = 'left-behind';
      const acked = await client.callTool({ name: 'ack_inbox', arguments: { event_id: eventId } });
      expect(acked.isError).toBe(true);
      expect(String((acked.content as Array<{ text: string }>)[0]?.text)).toBe('not_found');
    } finally {
      await close();
    }
  });
});
