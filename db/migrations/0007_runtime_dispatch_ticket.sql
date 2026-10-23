ALTER TABLE agent_automation_jobs ADD COLUMN started INTEGER NOT NULL DEFAULT 1 CHECK (started IN (0,1));
