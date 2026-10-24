import type { AuditPort } from '../modules/audit/index.js';
import type Database from 'better-sqlite3';
import type { MessageView } from '@agent-chat/contracts';
import type { InsertMessageOutcome, MessageRepository } from '../modules/messaging/index.js';
import { runImmediateTransaction } from './client.js';

interface MessageRow {
  id: string;
  group_id: string;
  author_kind: 'human' | 'agent';
  human_author_id: string | null;
  agent_author_id: string | null;
  text: string;
  created_at: string;
  human_display_name: string | null;
  agent_display_name: string | null;
  agent_owner_display_name: string | null;
}

interface IdempotencyRow {
  request_digest: string;
  message_id: string;
}

/**
 * The `messages` and `message_idempotency` tables behind the messaging port.
 *
 * The key claim and the insert share one immediate transaction, so two
 * concurrent retries cannot both create a message: the second one either reads
 * the first result or reports a conflict.
 */
export function createSqliteMessageRepository(
  sqlite: Database.Database,
  generateId: () => string,
  audit: AuditPort,
): MessageRepository {
  const nextSequence = sqlite.prepare(
    'SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM messages WHERE group_id = ?',
  );
  const insertMessage = sqlite.prepare(
    `INSERT INTO messages
       (id, group_id, author_kind, human_author_id, agent_author_id, text, created_at, sequence)
     VALUES
       (@id, @groupId, @authorKind, @humanAuthorId, @agentAuthorId, @text, @createdAt, @sequence)`,
  );
  const insertIdempotency = sqlite.prepare(
    `INSERT INTO message_idempotency
       (author_kind, human_author_id, agent_author_id, idempotency_key, request_digest, message_id, created_at)
     VALUES
       (@authorKind, @humanAuthorId, @agentAuthorId, @idempotencyKey, @requestDigest, @messageId, @createdAt)`,
  );
  const insertInboxEvent = sqlite.prepare(
    `INSERT INTO inbox_events
       (id, agent_id, sequence, group_id, message_id, event_type, created_at)
     VALUES (@id, @agentId, @sequence, @groupId, @messageId, @eventType, @createdAt)`,
  );
  const nextInboxSequence = sqlite.prepare(
    'SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM inbox_events WHERE agent_id = ?',
  );
  const findIdempotency = sqlite.prepare(
    `SELECT request_digest, message_id
       FROM message_idempotency
      WHERE author_kind = ?
        AND COALESCE(human_author_id, agent_author_id) = ?
        AND idempotency_key = ?`,
  );

  const selectColumns = `
    SELECT m.*,
           hu.display_name AS human_display_name,
           ag.name AS agent_display_name,
           owner.display_name AS agent_owner_display_name
      FROM messages m
      LEFT JOIN users hu ON hu.id = m.human_author_id
      LEFT JOIN agents ag ON ag.id = m.agent_author_id
      LEFT JOIN users owner ON owner.id = ag.owner_user_id`;

  const viewById = sqlite.prepare(`${selectColumns} WHERE m.id = ?`);
  const pageFirst = sqlite.prepare(
    `${selectColumns} WHERE m.group_id = ? ORDER BY m.sequence DESC LIMIT ?`,
  );
  // The cursor is the sequence of the last row of the previous page, so a page
  // boundary can never depend on a timestamp tie.
  const pageBefore = sqlite.prepare(
    `${selectColumns}
      WHERE m.group_id = ?
        AND m.sequence < (SELECT sequence FROM messages WHERE id = ?)
      ORDER BY m.sequence DESC
      LIMIT ?`,
  );

  return {
    insertWithIdempotency(input) {
      return runImmediateTransaction(sqlite, (): InsertMessageOutcome => {
        const authorKey = input.author.kind === 'human' ? 'human' : 'agent';
        const authorId = input.author.id;

        const existing = findIdempotency.get(
          authorKey,
          authorId,
          input.idempotencyKey,
        ) as IdempotencyRow | undefined;

        if (existing !== undefined) {
          return existing.request_digest === input.requestDigest
            ? { outcome: 'replayed', messageId: existing.message_id }
            : { outcome: 'conflict' };
        }

        const sequence = (
          nextSequence.get(input.groupId) as { next: number }
        ).next;

        insertMessage.run({
          id: input.id,
          sequence,
          groupId: input.groupId,
          authorKind: authorKey,
          humanAuthorId: authorKey === 'human' ? authorId : null,
          agentAuthorId: authorKey === 'agent' ? authorId : null,
          text: input.text,
          createdAt: input.createdAt,
        });

        insertIdempotency.run({
          authorKind: authorKey,
          humanAuthorId: authorKey === 'human' ? authorId : null,
          agentAuthorId: authorKey === 'agent' ? authorId : null,
          idempotencyKey: input.idempotencyKey,
          requestDigest: input.requestDigest,
          messageId: input.id,
          createdAt: input.createdAt,
        });

        // One pending event per agent member, in the same transaction as the
        // message itself. An agent does not get an event for its own message,
        // which is why the sender is filtered out here rather than at read time.
        for (const agentId of input.eligibleAgentIds) {
          if (authorKey === 'agent' && agentId === authorId) {
            continue;
          }
          const sequence = (nextInboxSequence.get(agentId) as { next: number }).next;
          insertInboxEvent.run({
            id: generateId(),
            agentId,
            sequence,
            groupId: input.groupId,
            messageId: input.id,
            eventType: 'message.created',
            createdAt: input.createdAt,
          });
        }

        audit.record({ actorKind: authorKey, actorId: authorId, action: 'message.sent', targetKind: 'message', targetId: input.id, outcome: 'allowed', createdAt: input.createdAt });
        return { outcome: 'created', messageId: input.id };
      });
    },

    listViews({ groupId, limit, before }) {
      const rows = (
        before === undefined
          ? pageFirst.all(groupId, limit)
          : pageBefore.all(groupId, before, limit)
      ) as MessageRow[];
      return rows.map(toView);
    },

    viewById(messageId) {
      const row = viewById.get(messageId) as MessageRow | undefined;
      return row === undefined ? undefined : toView(row);
    },
  };
}

function toView(row: MessageRow): MessageView {
  const author: MessageView['author'] =
    row.author_kind === 'human'
      ? { kind: 'human', id: row.human_author_id!, displayName: row.human_display_name ?? '' }
      : {
          kind: 'agent',
          id: row.agent_author_id!,
          displayName: row.agent_display_name ?? '',
          ownerDisplayName: row.agent_owner_display_name ?? '',
        };

  return {
    id: row.id,
    groupId: row.group_id,
    author,
    text: row.text,
    createdAt: row.created_at,
  };
}
