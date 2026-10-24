SET search_path=agent_chat,public;
ALTER TABLE receiver_leases ADD COLUMN IF NOT EXISTS principal text;
UPDATE receiver_leases SET principal='agent:'||connection_id WHERE principal IS NULL;
ALTER TABLE receiver_leases ALTER COLUMN principal SET NOT NULL;
ALTER TABLE receiver_leases ALTER COLUMN connection_id DROP NOT NULL;
ALTER TABLE receiver_leases ALTER COLUMN agent_id DROP NOT NULL;
RESET search_path;
