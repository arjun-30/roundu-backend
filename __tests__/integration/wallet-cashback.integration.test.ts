// DEV 1
// __tests__/integration/wallet-cashback.integration.test.ts
// Owner: Dev 3 / Dev 4

import request from 'supertest';
import { app } from '../../src/app';
import { db } from '../../src/config/database';
import {
  getOrCreateWallet,
  atomicCredit,
  atomicDebit,
} from '../../src/models/wallet.model';
import { createTestUser, getAuthToken, createTestProvider } from '../helpers';

let user: { id: string; phone: string };
let provider: { id: string; userId: string; phone: string };
let userToken: string;
let providerToken: string;

beforeAll(async () => {
  user     = await createTestUser({ role: 'user' });
  provider = await createTestProvider();
  userToken     = await getAuthToken(user.phone);
  providerToken = await getAuthToken(provider.phone);

  // Seed wallets.
  await getOrCreateWallet(user.id);
  await getOrCreateWallet(provider.userId);
});

afterAll(async () => {
  await db.query('DELETE FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id = ANY($1::uuid[]))', [[user.id, provider.userId]]);
  await db.query('DELETE FROM wallets WHERE user_id = ANY($1::uuid[])', [[user.id, provider.userId]]);
  await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[user.id, provider.userId]]);
});

// ─── GET /api/wallet ──────────────────────────────────────────────────────────

describe('GET /api/wallet', () => {
  it('should return wallet balance', async () => {
    const res = await request(app)
      .get('/api/wallet')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('balance');
    expect(res.body.data).toHaveProperty('balanceRupees');
    expect(res.body.data).toHaveProperty('currency', 'inr');
  });

  it('should reject unauthenticated request', async () => {
    const res = await request(app).get('/api/wallet');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/wallet/transactions ────────────────────────────────────────────

describe('GET /api/wallet/transactions', () => {
  beforeAll(async () => {
    // Seed a few transactions.
    await atomicCredit(user.id, 5000, 'cashback', undefined, 'Test cashback');
    await atomicCredit(user.id, 10000, 'topup',    undefined, 'Test topup');
  });

  it('should return paginated transaction history', async () => {
    const res = await request(app)
      .get('/api/wallet/transactions?page=1&limit=10')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body).toHaveProperty('total');
  });

  it('should filter by type=credit', async () => {
    const res = await request(app)
      .get('/api/wallet/transactions?type=credit')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    const types: string[] = res.body.data.map((t: { transaction_type: string }) => t.transaction_type);
    const debitTypes = ['booking_payment', 'withdrawal'];
    expect(types.every((t) => !debitTypes.includes(t))).toBe(true);
  });

  it('should filter by type=debit', async () => {
    // Seed a debit.
    await atomicDebit(user.id, 2000, 'booking_payment', undefined, 'Test debit');

    const res = await request(app)
      .get('/api/wallet/transactions?type=debit')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    const types: string[] = res.body.data.map((t: { transaction_type: string }) => t.transaction_type);
    const creditTypes = ['cashback', 'refund', 'topup', 'earning', 'referral_reward'];
    expect(types.every((t) => !creditTypes.includes(t))).toBe(true);
  });
});

// ─── POST /api/wallet/withdraw ────────────────────────────────────────────────

describe('POST /api/wallet/withdraw', () => {
  const fakeBankAccountId = '550e8400-e29b-41d4-a716-446655440000';

  beforeAll(async () => {
    // Give provider some balance.
    await atomicCredit(provider.userId, 100_000, 'earning', undefined, 'Test earning');
  });

  it('should queue a withdrawal for a provider', async () => {
    const res = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ amount: 20_000, bankAccountId: fakeBankAccountId });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('transactionId');
    expect(res.body.data.amount).toBe(20_000);
  });

  it('should reject withdrawal if balance is insufficient', async () => {
    const res = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ amount: 999_999_999, bankAccountId: fakeBankAccountId });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('should reject withdrawal below minimum (₹100)', async () => {
    const res = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ amount: 5_000, bankAccountId: fakeBankAccountId });

    expect(res.status).toBe(400);
  });

  it('should reject withdrawal by a regular user (not provider)', async () => {
    const res = await request(app)
      .post('/api/wallet/withdraw')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ amount: 10_000, bankAccountId: fakeBankAccountId });

    expect(res.status).toBe(403);
  });
});

// ─── Cashback idempotency ─────────────────────────────────────────────────────

describe('Cashback idempotency', () => {
  it('should not double-credit cashback for the same booking', async () => {
    const { creditCashback } = await import('../../src/services/cashback.service');
    const bookingId = '550e8400-e29b-41d4-a716-446655440001';

    // Set up platform settings.
    await db.query(
      `INSERT INTO platform_settings (key, value) VALUES ('cashback_percentage', '5')
       ON CONFLICT (key) DO UPDATE SET value = '5'`,
    );

    // First call — should credit.
    const r1 = await creditCashback(user.id, bookingId, 100_000);
    expect(r1.eligible).toBe(true);
    expect(r1.cashbackAmount).toBe(5_000);

    // Second call — should be a no-op.
    const r2 = await creditCashback(user.id, bookingId, 100_000);
    expect(r2.eligible).toBe(false);
    expect(r2.cashbackAmount).toBe(0);
  });
});
