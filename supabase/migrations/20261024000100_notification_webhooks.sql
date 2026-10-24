-- Server-owned notification configuration. Wake acceptance never acknowledges inbox.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

CREATE TABLE agent_chat.notification_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  dispatch_origin text,
  last_kicked_at timestamptz
);
INSERT INTO agent_chat.notification_settings(singleton) VALUES(true);

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM vault.secrets WHERE name='agent_chat_notification_dispatch') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'agent_chat_notification_dispatch');
  END IF;
END $$;

CREATE TABLE agent_chat.notification_configs (
  agent_id text PRIMARY KEY REFERENCES agent_chat.agents(id) ON DELETE CASCADE,
  connection_id text NOT NULL REFERENCES agent_chat.agent_connections(id),
  revision integer NOT NULL DEFAULT 1,
  platform text NOT NULL CHECK(platform IN ('grokbot','generic')),
  webhook_url text NOT NULL,
  secret_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  verified_at timestamptz,
  last_dispatched_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_chat.notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL REFERENCES agent_chat.agents(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  kind text NOT NULL CHECK(kind IN ('probe','wake')),
  event_id text REFERENCES agent_chat.inbox_events(id) ON DELETE CASCADE,
  challenge text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24),'hex'),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','accepted','confirmed','failed','uncertain','coalesced','cancelled')),
  claimed_at timestamptz,
  accepted_at timestamptz,
  confirmed_at timestamptz,
  status_code integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id,revision,event_id)
);
CREATE INDEX notification_jobs_pending ON agent_chat.notification_jobs(created_at) WHERE status='queued';
CREATE INDEX notification_jobs_agent ON agent_chat.notification_jobs(agent_id,created_at DESC);
CREATE TABLE agent_chat.notification_dispatch_nonces (
  nonce text PRIMARY KEY, expires_at timestamptz NOT NULL
);

-- Commit the wake job in the same transaction as the inbox event.
CREATE FUNCTION agent_chat.enqueue_notification() RETURNS trigger LANGUAGE plpgsql
SET search_path=agent_chat,pg_catalog AS $$
BEGIN
  INSERT INTO notification_jobs(agent_id,revision,kind,event_id)
    SELECT NEW.agent_id,c.revision,'wake',NEW.id FROM notification_configs c
    WHERE c.agent_id=NEW.agent_id AND c.enabled AND c.verified_at IS NOT NULL
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER inbox_notification AFTER INSERT ON agent_chat.inbox_events
  FOR EACH ROW EXECUTE FUNCTION agent_chat.enqueue_notification();

-- The only pg_net destination is the owner-configured application dispatcher.
-- Actual webhook requests use the application's pinned-DNS HTTPS transport.
CREATE FUNCTION agent_chat.kick_notification_dispatch(force_kick boolean DEFAULT false) RETURNS void LANGUAGE plpgsql
SET search_path=pg_catalog AS $$
DECLARE origin text; credential text; stamp text; nonce text;
BEGIN
  UPDATE agent_chat.notification_settings SET last_kicked_at=now()
    WHERE singleton AND dispatch_origin IS NOT NULL AND (force_kick OR last_kicked_at IS NULL OR last_kicked_at<now()-interval '2 seconds')
    RETURNING dispatch_origin INTO origin;
  IF origin IS NULL OR NOT EXISTS(SELECT 1 FROM agent_chat.notification_jobs j WHERE status='queued'
    OR (status='sending' AND claimed_at<now()-interval '2 minutes')
    OR (status='accepted' AND created_at<now()-interval '10 minutes')
    OR (status IN ('failed','uncertain') AND EXISTS(SELECT 1 FROM agent_chat.inbox_events e WHERE e.id=j.event_id AND e.acknowledged_at IS NOT NULL))) THEN RETURN; END IF;
  SELECT decrypted_secret INTO credential FROM vault.decrypted_secrets WHERE name='agent_chat_notification_dispatch';
  stamp:=floor(extract(epoch FROM clock_timestamp()))::text; nonce:=gen_random_uuid()::text;
  PERFORM net.http_post(url:=origin||'/internal/notifications/dispatch',
    headers:=jsonb_build_object('Content-Type','application/json','X-Agent-Chat-Time',stamp,'X-Agent-Chat-Nonce',nonce,
      'X-Agent-Chat-Signature',encode(extensions.hmac(stamp||'.'||nonce,credential,'sha256'),'hex')),
    body:='{}'::jsonb,timeout_milliseconds:=20000);
END $$;
CREATE FUNCTION agent_chat.wake_notification_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM agent_chat.kick_notification_dispatch(); RETURN NULL; END $$;
CREATE TRIGGER notification_dispatch AFTER INSERT ON agent_chat.notification_jobs
  FOR EACH ROW EXECUTE FUNCTION agent_chat.wake_notification_dispatch();

-- A queued job survives a stopped/frozen application instance or missed request.
SELECT cron.schedule('agent-chat-notification-dispatch','* * * * *',
  'SELECT agent_chat.kick_notification_dispatch()');

ALTER TABLE agent_chat.notification_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_chat.notification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_chat.notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_chat.notification_dispatch_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_chat.notification_configs,agent_chat.notification_jobs,agent_chat.notification_settings FROM PUBLIC,anon,authenticated;
REVOKE ALL ON agent_chat.notification_dispatch_nonces FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION agent_chat.enqueue_notification(),agent_chat.kick_notification_dispatch(boolean),agent_chat.wake_notification_dispatch() FROM PUBLIC,anon,authenticated;
