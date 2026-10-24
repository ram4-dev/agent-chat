ALTER TABLE native_runtime_targets ADD COLUMN proof_public_key TEXT;
CREATE TRIGGER native_proof_key_immutable BEFORE UPDATE OF proof_public_key ON native_runtime_targets
WHEN OLD.proof_public_key IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Native proof key is immutable'); END;
ALTER TABLE native_deliveries ADD COLUMN proof_public_key TEXT;
ALTER TABLE native_deliveries ADD COLUMN cancel_started INTEGER NOT NULL DEFAULT 0 CHECK(cancel_started IN (0,1));
ALTER TABLE native_deliveries ADD COLUMN started_at INTEGER;
ALTER TABLE native_deliveries ADD COLUMN terminal_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(terminal_confirmed IN (0,1));
ALTER TABLE native_deliveries ADD COLUMN owner_suppressed INTEGER NOT NULL DEFAULT 0 CHECK(owner_suppressed IN (0,1));
ALTER TABLE native_deliveries ADD COLUMN disposition TEXT CHECK(disposition IN ('published','no_reply','suppressed'));
ALTER TABLE native_deliveries ADD COLUMN result_hash TEXT;
ALTER TABLE native_deliveries ADD COLUMN terminal_proof TEXT;
ALTER TABLE native_deliveries ADD COLUMN evidence_hash TEXT;
ALTER TABLE native_deliveries ADD COLUMN conversation_ref TEXT;
CREATE TABLE native_binding_controllers (
  binding_id TEXT PRIMARY KEY REFERENCES native_bindings(id),
  grant_id TEXT NOT NULL REFERENCES native_connection_grants(id),
  controller_id TEXT NOT NULL,
  epoch INTEGER NOT NULL CHECK(epoch>0)
);
CREATE TRIGGER native_delivery_output_immutable BEFORE UPDATE OF decision,result_text,result_hash,conversation_ref ON native_deliveries
WHEN OLD.result_hash IS NOT NULL AND (
  NEW.result_hash IS NOT OLD.result_hash OR NEW.decision IS NOT OLD.decision OR NEW.conversation_ref IS NOT OLD.conversation_ref OR
  (NEW.result_text IS NOT OLD.result_text AND NOT (OLD.state='done' AND NEW.result_text IS NULL))
)
BEGIN SELECT RAISE(ABORT, 'Native output is immutable'); END;

CREATE INDEX native_delivery_retention ON native_deliveries(state,completed_at);
