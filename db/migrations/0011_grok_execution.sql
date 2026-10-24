ALTER TABLE native_deliveries ADD COLUMN provider_started INTEGER NOT NULL DEFAULT 0 CHECK(provider_started IN (0,1));
