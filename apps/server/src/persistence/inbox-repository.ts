import type Database from 'better-sqlite3';
import type {
  InboxEventView,
  InboxRepository,
} from '../modules/inbox/index.js';

interface InboxRow {
  id: string;
  group_id: string;
  sequence: number;
  created_at: string;
  message_id: string;
  message_text: string;
  mentioned_agent_ids: string;
  message_created_at: string;
  author_kind: 'human' | 'agent';
  author_id: string;
  author_name: string;
  owner_name: string | null;
}

/**
 * The `inbox_events` table behind the inbox module's port.
 *
 * Only rows that are still pending and still belong to a message are returned,
 * and the join brings the author along so a reader never has to make a second
 * request to act on the event. Acknowledgement sets the timestamp and never
 * deletes: a rejected acknowledgement leaves the event pending.
 */
export function createSqliteInboxRepository(sqlite: Database.Database): InboxRepository {
  const columns = `
    SELECT e.id, e.group_id, e.sequence, e.created_at,
           m.id AS message_id, m.text AS message_text, m.created_at AS message_created_at,
           m.author_kind, m.mentioned_agent_ids,
           COALESCE(m.human_author_id, m.agent_author_id) AS author_id,
           COALESCE(u.display_name, a.name) AS author_name, owner.display_name AS owner_name
      FROM inbox_events e
      JOIN messages m ON m.id = e.message_id
      LEFT JOIN users u ON u.id = m.human_author_id
      LEFT JOIN agents a ON a.id = m.agent_author_id
      LEFT JOIN users owner ON owner.id = a.owner_user_id`;

  const listPending = sqlite.prepare(
    `${columns}
      WHERE e.agent_id = ? AND e.acknowledged_at IS NULL
        AND EXISTS (SELECT 1 FROM group_agent_memberships gm WHERE gm.agent_id = e.agent_id AND gm.group_id = e.group_id)
        AND (? IS NULL OR e.sequence > ?)
      ORDER BY e.sequence ASC
      LIMIT ?`,
  );
  const findForMessage = sqlite.prepare(
    `${columns} WHERE e.message_id = ? AND e.agent_id = ? AND e.acknowledged_at IS NULL`,
  );
  const findPending = sqlite.prepare(
    `${columns} WHERE e.id = ? AND e.agent_id = ? AND e.acknowledged_at IS NULL`,
  );
  const findAny = sqlite.prepare(
    `${columns} WHERE e.id = ? AND e.agent_id = ?`,
  );
  const acknowledge = sqlite.prepare(
    'UPDATE inbox_events SET acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL',
  );

  return {
    findForMessage(messageId, agentId) {
      return toView(findForMessage.get(messageId, agentId) as InboxRow | undefined);
    },
    listPending(agentId, limit, after) {
      const rows = listPending.all(
        agentId,
        after ?? null,
        after ?? -1,
        limit,
      ) as InboxRow[];
      return rows
        .map(toView)
        .filter((view): view is InboxEventView => view !== undefined);
    },

    findPending(eventId, agentId) {
      return toView(findPending.get(eventId, agentId) as InboxRow | undefined);
    },

    findAny(eventId, agentId) {
      return toView(findAny.get(eventId, agentId) as InboxRow | undefined);
    },

    acknowledge(eventId, at) {
      acknowledge.run(at, eventId);
    },
  };
}

function toView(row: InboxRow | undefined): InboxEventView | undefined {
  if (row === undefined) {
    return undefined;
  }
  return {
    eventId: row.id,
    sequence: row.sequence,
    groupId: row.group_id,
    createdAt: row.created_at,
    message: {
      id: row.message_id,
      groupId: row.group_id,
      text: row.message_text,
      ...(row.mentioned_agent_ids && row.mentioned_agent_ids !== '[]' ? { mentionedAgentIds: JSON.parse(row.mentioned_agent_ids) as string[] } : {}),
      createdAt: row.message_created_at,
      author: {
        kind: row.author_kind,
        id: row.author_id,
        displayName: row.author_name,
        ...(row.author_kind === 'agent' ? { ownerDisplayName: row.owner_name ?? '' } : {}),
      } as InboxEventView['message']['author'],
    },
  };
}
