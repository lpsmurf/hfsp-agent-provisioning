-- HFSP Agent Provisioning schema
-- Phase 2: tenant persistence

CREATE TABLE IF NOT EXISTS tenants (
  id            TEXT PRIMARY KEY,          -- tenantId (e.g. "ta_1234567890")
  surface       TEXT NOT NULL,             -- 'telegram' | 'webapp' | 'extension'
  state         TEXT NOT NULL DEFAULT 'drafted',
                                           -- drafted | provisioning | provisioned |
                                           -- waiting_pair | live | stopped | deleted | failed
  container_name TEXT,                     -- e.g. "hfsp_ta_1234567890"
  gateway_port  INTEGER,                   -- allocated port (19000–19999)
  gateway_url   TEXT,                      -- ws://127.0.0.1:{port}
  image         TEXT,                      -- Docker image used
  error         TEXT,                      -- last error message if state=failed
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  provisioned_at TEXT,
  stopped_at    TEXT
);

-- Index for state queries (e.g. list all live tenants)
CREATE INDEX IF NOT EXISTS tenants_state ON tenants(state);
