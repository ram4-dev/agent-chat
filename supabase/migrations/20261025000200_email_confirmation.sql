CREATE TABLE agent_chat.email_confirmation_uses (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE agent_chat.email_confirmation_uses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_chat.email_confirmation_uses FROM anon, authenticated;
