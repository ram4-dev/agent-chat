SET search_path TO agent_chat, public;
ALTER TABLE group_human_memberships ADD COLUMN read_sequence bigint NOT NULL DEFAULT 0 CHECK (read_sequence >= 0);
CREATE TABLE group_human_message_reads (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id, message_id),
  FOREIGN KEY (group_id, user_id) REFERENCES group_human_memberships(group_id, user_id) ON DELETE CASCADE
);
CREATE FUNCTION enforce_human_read_group() RETURNS trigger LANGUAGE plpgsql SET search_path TO agent_chat,public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM messages WHERE id=NEW.message_id AND group_id=NEW.group_id) THEN
    RAISE EXCEPTION 'read message outside group';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER human_read_same_group BEFORE INSERT ON group_human_message_reads
FOR EACH ROW EXECUTE FUNCTION enforce_human_read_group();
CREATE FUNCTION enforce_human_read_monotonic() RETURNS trigger LANGUAGE plpgsql SET search_path TO agent_chat,public AS $$
BEGIN
  IF NEW.read_sequence < OLD.read_sequence THEN RAISE EXCEPTION 'read sequence cannot decrease'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER human_read_monotonic BEFORE UPDATE OF read_sequence ON group_human_memberships
FOR EACH ROW EXECUTE FUNCTION enforce_human_read_monotonic();
ALTER TABLE group_human_message_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON group_human_message_reads FROM anon, authenticated;
REVOKE ALL ON FUNCTION enforce_human_read_group(), enforce_human_read_monotonic() FROM PUBLIC;
