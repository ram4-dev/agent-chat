-- Native authority is explicit and separate from OAuth's legacy default scopes.
CREATE TABLE native_pairing_challenges (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  connection_id TEXT NOT NULL REFERENCES agent_connections(id),
  consent_json TEXT NOT NULL CHECK(json_valid(consent_json)),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE native_connection_grants (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL UNIQUE REFERENCES agent_connections(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('automatic','interactive')),
  binding_id TEXT,
  revision INTEGER,
  target_id TEXT,
  scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json)),
  selections_json TEXT NOT NULL CHECK(json_valid(selections_json)),
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(binding_id,revision,target_id) REFERENCES native_binding_versions(binding_id,revision,target_id),
  CHECK((kind='automatic' AND binding_id IS NOT NULL AND revision IS NOT NULL AND target_id IS NOT NULL)
     OR (kind='interactive' AND binding_id IS NULL AND revision IS NULL AND target_id IS NULL))
);
-- A classified connection never falls back to legacy, including after revocation.
CREATE TRIGGER native_grant_identity_immutable
BEFORE UPDATE OF id,connection_id,owner_user_id,kind,binding_id,revision,target_id ON native_connection_grants
BEGIN SELECT RAISE(ABORT, 'Native grant identity is immutable'); END;
CREATE TRIGGER native_grant_no_delete BEFORE DELETE ON native_connection_grants
BEGIN SELECT RAISE(ABORT, 'Native grant classification is permanent'); END;
