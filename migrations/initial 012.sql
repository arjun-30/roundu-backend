-- Migration 012 - TODO
-- Migration: 012_wallets
-- Owner: Dev 1 (Wallet + Stripe + Cashback)
-- One wallet per user. Balance can never go negative (enforced by CHECK + service-level lock).

CREATE TABLE wallets (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID          NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance     NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  currency    VARCHAR(10)   NOT NULL DEFAULT 'inr',
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallets_user_id ON wallets(user_id);
