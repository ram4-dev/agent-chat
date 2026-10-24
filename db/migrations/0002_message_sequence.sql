-- 0002_message_sequence
--
-- Give every message a per-group creation order.
--
-- The initial migration ordered messages by (created_at, id), which is not a
-- stable creation order: two messages written in the same millisecond tie on
-- the timestamp, and a UUIDv7 breaks that tie by its random tail. Pagination
-- and the realtime feed could then show one message before an older one.
--
-- The sequence is allocated inside the same immediate transaction as the
-- insert, so it is strictly increasing per group and never reused.

ALTER TABLE messages ADD COLUMN sequence INTEGER;

-- Deterministic backfill for rows written before this migration: ties on the
-- timestamp keep insertion order because a UUIDv7 id is itself time-ordered.
UPDATE messages
   SET sequence = (
     SELECT COUNT(*)
       FROM messages earlier
      WHERE earlier.group_id = messages.group_id
        AND (
          earlier.created_at < messages.created_at
          OR (earlier.created_at = messages.created_at AND earlier.id <= messages.id)
        )
   );

CREATE UNIQUE INDEX messages_group_sequence_idx ON messages (group_id, sequence);

DROP INDEX IF EXISTS messages_group_created_idx;
CREATE INDEX messages_group_sequence_lookup_idx ON messages (group_id, sequence DESC);
