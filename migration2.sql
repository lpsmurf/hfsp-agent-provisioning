-- Migration 2: multi-VPS, deletion, renewal reminders

-- VPS nodes registry
CREATE TABLE IF NOT EXISTS vps_nodes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,           -- human label e.g. 'piercalito'
  host                TEXT NOT NULL,           -- IP or hostname; 'localhost' for control plane
  ssh_user            TEXT NOT NULL DEFAULT 'hfsp',
  ssh_key_path        TEXT NOT NULL DEFAULT '',
  port_range_start    INTEGER NOT NULL DEFAULT 19000,
  port_range_end      INTEGER NOT NULL DEFAULT 19999,
  status              TEXT NOT NULL DEFAULT 'active', -- active | draining | offline
  capacity_agents_max INTEGER NOT NULL DEFAULT 50,
  agents_current      INTEGER NOT NULL DEFAULT 0,
  added_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed PIERCALITO as node 1 (local)
INSERT OR IGNORE INTO vps_nodes (id, name, host, ssh_user, ssh_key_path, port_range_start, port_range_end, status, capacity_agents_max)
VALUES (1, 'piercalito', 'localhost', 'hfsp', '', 19000, 19999, 'active', 50);

-- Update agents_current to reflect real state
UPDATE vps_nodes SET agents_current = (
  SELECT COUNT(*) FROM tenants
  WHERE status IN ('active','provisioning') AND deleted_at IS NULL
) WHERE id = 1;

-- Add vps_node_id to tenants
ALTER TABLE tenants ADD COLUMN vps_node_id INTEGER DEFAULT 1;

-- Backfill existing tenants to node 1
UPDATE tenants SET vps_node_id = 1 WHERE vps_node_id IS NULL;

-- Add reminded_at to subscriptions
ALTER TABLE subscriptions ADD COLUMN reminded_at TEXT;

-- Add deleted_at to tenants if missing (may already exist)
-- ALTER TABLE tenants ADD COLUMN deleted_at TEXT;  -- skip if exists

CREATE INDEX IF NOT EXISTS idx_vps_nodes_status ON vps_nodes(status);
CREATE INDEX IF NOT EXISTS idx_tenants_node ON tenants(vps_node_id);
