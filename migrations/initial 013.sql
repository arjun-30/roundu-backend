-- Migration 013 - TODO
-- Migration: 013_wallet_transactions
-- Owner: Dev 1 (Wallet + Stripe + Cashback)
-- Immutable ledger — rows are NEVER updated or deleted, only inserted.

CREATE TYPE wallet_txn_type AS ENUM ('credit', 'debit');

CREATE TYPE wallet_txn_reason AS ENUM (
  'booking_payment',   -- user paid for a booking from wallet
  'booking_refund',    -- refund credited back to wallet
  'cashback',          -- platform cashback reward
  'referral_reward',   -- reward for referring a friend
  'withdrawal',        -- provider withdrawing earnings
  'admin_adjustment'   -- manual admin credit/debit
);

CREATE TABLE wallet_transactions (
  id            UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id     UUID            NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  user_id       UUID            NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  type          wallet_txn_type   NOT NULL,
  reason        wallet_txn_reason NOT NULL,
  amount        NUMERIC(10,2)   NOT NULL CHECK (amount > 0),
  balance_after NUMERIC(10,2)   NOT NULL,           -- snapshot for audit trail
  reference_id  UUID,                               -- booking_id, payment_id, referral_id …
  description   TEXT,
  metadata      JSONB           NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
  -- intentionally no updated_at — this table is append-only
);

CREATE INDEX idx_wallet_txn_wallet_id   ON wallet_transactions(wallet_id);
CREATE INDEX idx_wallet_txn_user_id     ON wallet_transactions(user_id);
CREATE INDEX idx_wallet_txn_type        ON wallet_transactions(type);
CREATE INDEX idx_wallet_txn_reason      ON wallet_transactions(reason);
CREATE INDEX idx_wallet_txn_created_at  ON wallet_transactions(created_at DESC);
