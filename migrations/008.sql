-- Migration 008: OTP Codes
-- Stores hashed OTPs for phone-based authentication.
-- We store a bcrypt hash (never plaintext) and expire after 10 minutes.

CREATE TABLE IF NOT EXISTS otp_codes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       VARCHAR(15) NOT NULL,
  otp_hash    TEXT        NOT NULL,           -- bcrypt hash of the 6-digit OTP
  purpose     VARCHAR(20) NOT NULL DEFAULT 'auth',  -- 'auth' | 'verify'
  is_used     BOOLEAN     NOT NULL DEFAULT FALSE,
  attempts    SMALLINT    NOT NULL DEFAULT 0,  -- failed verify attempts
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup: given a phone, find its latest unused, unexpired OTP
CREATE INDEX IF NOT EXISTS idx_otp_codes_phone_active
  ON otp_codes (phone, is_used, expires_at);

-- Cleanup old rows easily
CREATE INDEX IF NOT EXISTS idx_otp_codes_expires_at
  ON otp_codes (expires_at);

COMMENT ON TABLE otp_codes IS
  'Stores hashed OTPs for phone-based auth. Expired rows cleaned by cleanup.job.ts.';
