-- Migration: add subscriptions + invoices tables
-- Run: sqlite3 data/storefront.sqlite < schema_migration.sql

CREATE TABLE IF NOT EXISTS plans (
  id           TEXT PRIMARY KEY,   -- 'starter_monthly', 'operator_yearly', etc.
  name         TEXT NOT NULL,       -- 'Starter', 'Operator', 'Node'
  tier         TEXT NOT NULL,       -- 'starter', 'operator', 'node'
  billing      TEXT NOT NULL,       -- 'monthly', 'yearly'
  price_usd    REAL NOT NULL,
  max_agents   INTEGER NOT NULL,
  model_access TEXT NOT NULL        -- 'fast', 'any'
);

INSERT OR IGNORE INTO plans VALUES ('starter_monthly',  'Starter',  'starter',  'monthly',  19,  1, 'fast');
INSERT OR IGNORE INTO plans VALUES ('starter_yearly',   'Starter',  'starter',  'yearly',  179,  1, 'fast');
INSERT OR IGNORE INTO plans VALUES ('operator_monthly', 'Operator', 'operator', 'monthly',  49,  3, 'any');
INSERT OR IGNORE INTO plans VALUES ('operator_yearly',  'Operator', 'operator', 'yearly',  469,  3, 'any');
INSERT OR IGNORE INTO plans VALUES ('node_monthly',     'Node',     'node',     'monthly',  99, 10, 'any');
INSERT OR IGNORE INTO plans VALUES ('node_yearly',      'Node',     'node',     'yearly',  949, 10, 'any');

CREATE TABLE IF NOT EXISTS subscriptions (
  id                TEXT PRIMARY KEY,
  telegram_user_id  INTEGER NOT NULL,
  plan_id           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
    -- pending | active | expired | cancelled | past_due
  period_start      TEXT,
  period_end        TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE INDEX IF NOT EXISTS sub_user ON subscriptions(telegram_user_id);
CREATE INDEX IF NOT EXISTS sub_status ON subscriptions(status);

CREATE TABLE IF NOT EXISTS invoices (
  id                     TEXT PRIMARY KEY,   -- 'inv_xxxxxxxxxx'
  telegram_user_id       INTEGER NOT NULL,
  subscription_id        TEXT,
  plan_id                TEXT NOT NULL,
  amount_usd             REAL NOT NULL,
  pay_currency           TEXT,               -- 'btc','eth','sol','usdc'
  pay_address            TEXT,
  pay_amount             REAL,
  nowpayments_id         TEXT,               -- NOWPayments payment_id
  nowpayments_status     TEXT,               -- waiting|confirming|confirmed|failed|expired
  ipn_payload            TEXT,               -- raw JSON from last IPN webhook
  expires_at             TEXT,
  confirmed_at           TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS inv_user   ON invoices(telegram_user_id);
CREATE INDEX IF NOT EXISTS inv_status ON invoices(nowpayments_status);
CREATE INDEX IF NOT EXISTS inv_np_id  ON invoices(nowpayments_id);

-- Add plan/subscription columns to tenants if not present
ALTER TABLE tenants ADD COLUMN subscription_id TEXT;
ALTER TABLE tenants ADD COLUMN plan_id         TEXT;
