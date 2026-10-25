-- Human reads are independent of inbox_events. Exact message receipts preserve
-- gaps in pagination/reconnect; a maximum cursor must never mark those gaps read.
ALTER TABLE group_human_memberships ADD COLUMN read_sequence INTEGER NOT NULL DEFAULT 0 CHECK (read_sequence >= 0);
CREATE TABLE group_human_message_reads (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id, message_id),
  FOREIGN KEY (group_id, user_id) REFERENCES group_human_memberships(group_id, user_id) ON DELETE CASCADE
);
CREATE TRIGGER human_read_same_group BEFORE INSERT ON group_human_message_reads
WHEN NOT EXISTS (SELECT 1 FROM messages WHERE id = NEW.message_id AND group_id = NEW.group_id)
BEGIN SELECT RAISE(ABORT, 'read message outside group'); END;
CREATE TRIGGER human_read_monotonic BEFORE UPDATE OF read_sequence ON group_human_memberships
WHEN NEW.read_sequence < OLD.read_sequence
BEGIN SELECT RAISE(ABORT, 'read sequence cannot decrease'); END;
