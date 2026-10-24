CREATE TABLE agent_chat.password_reset_uses (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL,
  used_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE agent_chat.password_reset_uses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_chat.password_reset_uses FROM PUBLIC,anon,authenticated;
