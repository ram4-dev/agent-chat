CREATE TABLE agent_runtimes (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id),
  instance_id TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES agent_connections(id),
  last_seen INTEGER NOT NULL
);
CREATE TABLE agent_automation_bindings (
  agent_id TEXT NOT NULL REFERENCES agents(id),
  group_id TEXT NOT NULL REFERENCES groups(id),
  enabled INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL,
  thread_id TEXT,
  last_error TEXT,
  PRIMARY KEY (agent_id, group_id)
);
CREATE TABLE agent_automation_jobs (
  event_id TEXT PRIMARY KEY REFERENCES inbox_events(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  group_id TEXT NOT NULL REFERENCES groups(id),
  connection_id TEXT NOT NULL REFERENCES agent_connections(id),
  instance_id TEXT NOT NULL,
  claim TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('running','generated','published','done','needs_review')),
  decision TEXT,
  output TEXT,
  thread_id TEXT,
  message_id TEXT REFERENCES messages(id),
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX automation_one_running_per_agent
  ON agent_automation_jobs(agent_id) WHERE state = 'running';
