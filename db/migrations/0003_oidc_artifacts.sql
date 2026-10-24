-- 0003_oidc_artifacts
--
-- Storage for the in-process OAuth/OIDC authorization server.
--
-- The approved Program Design selects `oidc-provider` and forbids hand-rolling
-- the protocol. The library owns its own state model (Session, Interaction,
-- AuthorizationCode, AccessToken, RefreshToken, Grant, ReplayDetection, and the
-- rest) and persists it through a generic key-value adapter. Reimplementing that
-- contract across bespoke per-model tables would be exactly the hand-rolling the
-- design rejects, so provider-owned artifacts live in one generic table.
--
-- Ownership stays split and explicit:
--   oidc_artifacts        -> provider-owned protocol state, keyed by model and id
--   oauth_clients         -> the client registry the provider adapter mirrors
--   agent_connections     -> OUR authority: the row a revocation writes to
--   oauth_grants          -> reserved for S8 grant bookkeeping
--   oauth_refresh_tokens  -> reserved for S8 rotation-family revocation
--
-- A row carries its own expiry so an expired artifact is never returned, and
-- the index makes cleanup a bounded delete rather than a scan.

CREATE TABLE oidc_artifacts (
  model TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  -- Null means the artifact has no expiry of its own (for example a client).
  expires_at TEXT,
  consumed_at TEXT,
  user_code TEXT,
  uid TEXT,
  grant_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (model, id)
);

-- Expiry sweeps and "is this artifact still alive" lookups.
CREATE INDEX oidc_artifacts_expiry_idx ON oidc_artifacts (model, expires_at);

-- The provider resolves a device or session by user code and by uid.
CREATE INDEX oidc_artifacts_user_code_idx ON oidc_artifacts (user_code)
  WHERE user_code IS NOT NULL;
CREATE INDEX oidc_artifacts_uid_idx ON oidc_artifacts (uid) WHERE uid IS NOT NULL;

-- Revoking a grant must reach every artifact that belongs to it.
CREATE INDEX oidc_artifacts_grant_idx ON oidc_artifacts (grant_id)
  WHERE grant_id IS NOT NULL;
