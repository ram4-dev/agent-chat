ALTER TABLE agent_chat.messages ADD COLUMN mentioned_agent_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(mentioned_agent_ids)='array');
