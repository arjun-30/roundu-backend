-- Migration: 014_referrals.sql
-- Owner: Dev 4

-- Referral codes table (one code per user, lazily created)
CREATE TABLE IF NOT EXISTS referral_codes (
  user_id  UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code     VARCHAR(32) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);

-- Referral events (one row per successful apply)
CREATE TABLE IF NOT EXISTS referrals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code          VARCHAR(32) NOT NULL,
  reward_amount NUMERIC(10, 2) NOT NULL DEFAULT 50,
  currency      VARCHAR(8) NOT NULL DEFAULT 'INR',
  status        VARCHAR(16) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'settled', 'expired')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at    TIMESTAMPTZ,

  -- A user can only ever be referred once
  UNIQUE (referred_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code     ON referrals(code);