import { Pool } from 'pg';

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres@localhost:5432/roundu_test';

let sharedPool: Pool | null = null;

export function getTestPool(): Pool {
  if (sharedPool) return sharedPool;
  sharedPool = new Pool({ connectionString: TEST_DATABASE_URL, max: 5 });
  return sharedPool;
}

export async function closeTestPool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = null;
  }
}

/**
 * Minimal schema for tests — mirrors only what the implemented code reads/writes.
 * Real migrations are stubs in `migrations/` so this is the source of truth for
 * test DB shape.
 */
const SCHEMA_SQL = `
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";

  DROP TABLE IF EXISTS tracking_locations CASCADE;
  DROP TABLE IF EXISTS tracking_sessions CASCADE;
  DROP TABLE IF EXISTS wallet_transactions CASCADE;
  DROP TABLE IF EXISTS wallets CASCADE;
  DROP TABLE IF EXISTS referrals CASCADE;
  DROP TABLE IF EXISTS referral_codes CASCADE;
  DROP TABLE IF EXISTS bookings CASCADE;
  DROP TABLE IF EXISTS providers CASCADE;
  DROP TABLE IF EXISTS users CASCADE;

  CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone       VARCHAR(20) UNIQUE,
    name        VARCHAR(100) NOT NULL DEFAULT 'Test User',
    email       VARCHAR(150),
    role        VARCHAR(16) NOT NULL DEFAULT 'user'
                  CHECK (role IN ('user', 'provider', 'admin')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE providers (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_approved  BOOLEAN NOT NULL DEFAULT false,
    is_available BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE bookings (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status         VARCHAR(20) NOT NULL DEFAULT 'confirmed',
    scheduled_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE wallets (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    balance      NUMERIC(14, 2) NOT NULL DEFAULT 0,
    currency     VARCHAR(8) NOT NULL DEFAULT 'INR',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE wallet_transactions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type         VARCHAR(10) NOT NULL CHECK (type IN ('credit', 'debit')),
    amount       NUMERIC(14, 2) NOT NULL,
    currency     VARCHAR(8) NOT NULL DEFAULT 'INR',
    description  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE referral_codes (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code        VARCHAR(32) UNIQUE NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX idx_referral_codes_code ON referral_codes(code);

  CREATE TABLE referrals (
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
    UNIQUE (referred_id)
  );

  CREATE TABLE tracking_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id      UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    provider_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          VARCHAR(16) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'ended')),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMPTZ,
    last_lat        NUMERIC(10, 7),
    last_lng        NUMERIC(10, 7),
    last_updated_at TIMESTAMPTZ
  );

  CREATE TABLE tracking_locations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
    lat         NUMERIC(10, 7) NOT NULL,
    lng         NUMERIC(10, 7) NOT NULL,
    accuracy    NUMERIC(8, 2),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

export async function initTestSchema(): Promise<void> {
  const pool = getTestPool();
  await pool.query(SCHEMA_SQL);
}

export async function resetTestData(): Promise<void> {
  const pool = getTestPool();
  await pool.query(`
    TRUNCATE TABLE
      tracking_locations,
      tracking_sessions,
      wallet_transactions,
      wallets,
      referrals,
      referral_codes,
      bookings,
      providers,
      users
    RESTART IDENTITY CASCADE;
  `);
}

export async function waitForDb(timeoutMs = 15000): Promise<void> {
  const pool = getTestPool();
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(
    `Test database not reachable at ${TEST_DATABASE_URL}: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}
