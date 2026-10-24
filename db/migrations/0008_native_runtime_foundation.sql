-- Passive native-runtime foundation. Legacy consumers keep their original tables.
CREATE UNIQUE INDEX agents_native_owner_key ON agents(id, owner_user_id);
CREATE UNIQUE INDEX inbox_native_identity_key ON inbox_events(id, agent_id, group_id);

CREATE TABLE native_runtime_targets (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK(provider IN ('legacy_codex','codex','hermes','grok_bot')),
  connector_id TEXT NOT NULL CHECK(length(trim(connector_id)) > 0),
  native_ref TEXT NOT NULL CHECK(length(trim(native_ref)) > 0),
  context_mode TEXT NOT NULL CHECK(context_mode IN ('native_per_group','shared_bot_context','unsupported')),
  capabilities_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(capabilities_json) AND json_type(capabilities_json)='object'),
  verified_at INTEGER,
  UNIQUE(id, owner_user_id),
  UNIQUE(owner_user_id, provider, connector_id, native_ref)
);
CREATE TRIGGER native_target_identity_immutable
BEFORE UPDATE OF id, owner_user_id, provider, connector_id, native_ref ON native_runtime_targets
BEGIN SELECT RAISE(ABORT, 'Native target identity is immutable'); END;

CREATE TABLE native_bindings (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL,
  current_revision INTEGER NOT NULL CHECK(current_revision > 0),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  legacy_projection INTEGER NOT NULL DEFAULT 0 CHECK(legacy_projection IN (0,1)),
  UNIQUE(id, owner_user_id),
  UNIQUE(id, agent_id),
  FOREIGN KEY(agent_id, owner_user_id) REFERENCES agents(id, owner_user_id),
  FOREIGN KEY(id, current_revision) REFERENCES native_binding_versions(binding_id, revision) DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER native_binding_identity_immutable
BEFORE UPDATE OF id, agent_id, owner_user_id ON native_bindings
BEGIN SELECT RAISE(ABORT, 'Native binding identity is immutable'); END;

CREATE TABLE native_binding_versions (
  binding_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  target_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  PRIMARY KEY(binding_id, revision),
  UNIQUE(binding_id, revision, target_id),
  FOREIGN KEY(binding_id, owner_user_id) REFERENCES native_bindings(id, owner_user_id),
  FOREIGN KEY(target_id, owner_user_id) REFERENCES native_runtime_targets(id, owner_user_id)
);
CREATE TRIGGER native_binding_version_immutable BEFORE UPDATE ON native_binding_versions
BEGIN SELECT RAISE(ABORT, 'Native binding version is immutable'); END;

CREATE TABLE native_binding_groups (
  binding_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  group_id TEXT NOT NULL REFERENCES groups(id),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  allowed_sender_refs_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(allowed_sender_refs_json) AND json_type(allowed_sender_refs_json)='array'),
  PRIMARY KEY(binding_id, revision, group_id),
  FOREIGN KEY(binding_id, revision) REFERENCES native_binding_versions(binding_id, revision)
);
CREATE TRIGGER native_group_configuration_immutable
BEFORE UPDATE OF binding_id, revision, group_id, allowed_sender_refs_json ON native_binding_groups
BEGIN SELECT RAISE(ABORT, 'Create a new revision to change native groups'); END;
CREATE TRIGGER native_group_context_guard BEFORE INSERT ON native_binding_groups
WHEN EXISTS (
  SELECT 1 FROM native_binding_versions v JOIN native_runtime_targets t ON t.id=v.target_id
  WHERE v.binding_id=NEW.binding_id AND v.revision=NEW.revision AND (
    t.context_mode='unsupported' OR (t.context_mode='shared_bot_context' AND EXISTS (
      SELECT 1 FROM native_binding_groups g JOIN native_binding_versions previous
        ON previous.binding_id=g.binding_id AND previous.revision=g.revision
      WHERE previous.target_id=t.id AND g.group_id<>NEW.group_id
    ))
  )
)
BEGIN SELECT RAISE(ABORT, 'Native target does not isolate group context'); END;
CREATE TRIGGER native_context_change_guard BEFORE UPDATE OF context_mode ON native_runtime_targets
WHEN (NEW.context_mode='unsupported' AND EXISTS (
    SELECT 1 FROM native_binding_versions v JOIN native_binding_groups g
      ON g.binding_id=v.binding_id AND g.revision=v.revision WHERE v.target_id=OLD.id
  )) OR (NEW.context_mode='shared_bot_context' AND (
    SELECT count(DISTINCT g.group_id) FROM native_binding_versions v JOIN native_binding_groups g
      ON g.binding_id=v.binding_id AND g.revision=v.revision WHERE v.target_id=OLD.id
  ) > 1)
BEGIN SELECT RAISE(ABORT, 'Native target already has incompatible group context'); END;

CREATE TABLE native_conversations (
  binding_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  group_id TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation > 0),
  native_ref TEXT,
  PRIMARY KEY(binding_id, revision, group_id, generation),
  FOREIGN KEY(binding_id, revision, group_id) REFERENCES native_binding_groups(binding_id, revision, group_id)
);

CREATE TABLE native_deliveries (
  event_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  binding_revision INTEGER NOT NULL,
  target_id TEXT NOT NULL,
  grant_id TEXT,
  controller_id TEXT,
  controller_epoch INTEGER NOT NULL DEFAULT 0 CHECK(controller_epoch >= 0),
  claim TEXT UNIQUE,
  start_key TEXT UNIQUE,
  started INTEGER NOT NULL DEFAULT 0 CHECK(started IN (0,1)),
  state TEXT NOT NULL CHECK(state IN ('queued','claimed','start_uncertain','running','awaiting_approval','result_saved','done','needs_review','cancel_requested')),
  native_run_ref TEXT,
  decision TEXT CHECK(decision IN ('reply','no_reply')),
  result_text TEXT,
  message_id TEXT REFERENCES messages(id),
  error_code TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY(event_id, agent_id, group_id) REFERENCES inbox_events(id, agent_id, group_id),
  FOREIGN KEY(binding_id, agent_id) REFERENCES native_bindings(id, agent_id),
  FOREIGN KEY(binding_id, binding_revision, target_id) REFERENCES native_binding_versions(binding_id, revision, target_id),
  FOREIGN KEY(binding_id, binding_revision, group_id) REFERENCES native_binding_groups(binding_id, revision, group_id),
  CHECK(state<>'result_saved' OR (decision IS NOT NULL AND result_text IS NOT NULL)),
  CHECK(message_id IS NULL OR decision='reply')
);
CREATE UNIQUE INDEX native_one_active_per_target ON native_deliveries(target_id)
  WHERE state NOT IN ('queued','done');

-- Read-only legacy projection: no native grants, jobs, controllers or consumers.
INSERT INTO native_runtime_targets(id,owner_user_id,provider,connector_id,native_ref,context_mode)
SELECT DISTINCT a.id,a.owner_user_id,'legacy_codex','legacy-local',a.id,'native_per_group'
FROM agents a JOIN agent_automation_bindings b ON b.agent_id=a.id;
INSERT INTO native_bindings(id,agent_id,owner_user_id,current_revision,legacy_projection)
SELECT id,id,owner_user_id,1,1 FROM native_runtime_targets;
INSERT INTO native_binding_versions(binding_id,revision,target_id,owner_user_id)
SELECT id,1,id,owner_user_id FROM native_runtime_targets;
INSERT INTO native_binding_groups(binding_id,revision,group_id,enabled)
SELECT agent_id,1,group_id,enabled FROM agent_automation_bindings;
INSERT INTO native_conversations(binding_id,revision,group_id,native_ref)
SELECT agent_id,1,group_id,thread_id FROM agent_automation_bindings;
