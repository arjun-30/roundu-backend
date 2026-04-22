import { Pool } from 'pg';

export interface TestUser {
  id: string;
  name: string;
  role: 'user' | 'provider' | 'admin';
  phone: string;
}

let userCounter = 0;

export async function createTestUser(
  db: Pool,
  overrides: Partial<TestUser> = {},
): Promise<TestUser> {
  userCounter += 1;
  const suffix = `${Date.now()}-${userCounter}`;
  const name = overrides.name ?? `Test User ${suffix}`;
  const role = overrides.role ?? 'user';
  const phone = overrides.phone ?? `+9199${String(userCounter).padStart(8, '0')}`;

  const result = await db.query<{ id: string }>(
    `INSERT INTO users (name, phone, role) VALUES ($1, $2, $3) RETURNING id`,
    [name, phone, role],
  );
  return { id: result.rows[0].id, name, role, phone };
}

export async function createTestProvider(
  db: Pool,
  overrides: Partial<TestUser> = {},
): Promise<TestUser & { providerRowId: string }> {
  const user = await createTestUser(db, { ...overrides, role: 'provider' });
  const providerRow = await db.query<{ id: string }>(
    `INSERT INTO providers (user_id, is_approved, is_available)
     VALUES ($1, true, true) RETURNING id`,
    [user.id],
  );
  return { ...user, providerRowId: providerRow.rows[0].id };
}

export async function createBooking(
  db: Pool,
  opts: { userId: string; providerId: string; status?: string },
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO bookings (user_id, provider_id, status) VALUES ($1, $2, $3) RETURNING id`,
    [opts.userId, opts.providerId, opts.status ?? 'confirmed'],
  );
  return result.rows[0].id;
}

export async function createWallet(
  db: Pool,
  userId: string,
  balance = 0,
): Promise<{ id: string; balance: number }> {
  const result = await db.query<{ id: string; balance: string }>(
    `INSERT INTO wallets (user_id, balance, currency) VALUES ($1, $2, 'INR') RETURNING id, balance`,
    [userId, balance],
  );
  return { id: result.rows[0].id, balance: parseFloat(result.rows[0].balance) };
}

export async function createReferralCode(
  db: Pool,
  userId: string,
  code: string,
): Promise<void> {
  await db.query(
    `INSERT INTO referral_codes (user_id, code) VALUES ($1, $2)`,
    [userId, code],
  );
}

export async function getWalletBalance(db: Pool, userId: string): Promise<number> {
  const result = await db.query<{ balance: string }>(
    `SELECT balance FROM wallets WHERE user_id = $1`,
    [userId],
  );
  if (result.rows.length === 0) return 0;
  return parseFloat(result.rows[0].balance);
}

export async function countWalletTransactions(
  db: Pool,
  userId: string,
  type?: 'credit' | 'debit',
): Promise<number> {
  const sql = type
    ? `SELECT COUNT(*)::int AS c FROM wallet_transactions WHERE user_id = $1 AND type = $2`
    : `SELECT COUNT(*)::int AS c FROM wallet_transactions WHERE user_id = $1`;
  const params = type ? [userId, type] : [userId];
  const result = await db.query<{ c: number }>(sql, params);
  return result.rows[0].c;
}
