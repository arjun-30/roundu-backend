/**
 * Unit tests for WalletModel against a real test Postgres. The wallet controller
 * itself is partial; these tests exercise the model layer it calls into.
 */
import { Pool } from 'pg';
import { WalletModel } from '../../src/models/wallet.model';
import {
  getTestPool,
  closeTestPool,
  initTestSchema,
  resetTestData,
  waitForDb,
} from '../helpers/db';
import { createTestUser } from '../helpers/factories';

describe('WalletModel', () => {
  let db: Pool;
  let model: WalletModel;

  beforeAll(async () => {
    db = getTestPool();
    await waitForDb();
    await initTestSchema();
    model = new WalletModel(db);
  });

  beforeEach(async () => {
    await resetTestData();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('findByUserId returns null when no wallet exists', async () => {
    const user = await createTestUser(db);
    expect(await model.findByUserId(user.id)).toBeNull();
  });

  it('create inserts a zero-balance wallet', async () => {
    const user = await createTestUser(db);
    const wallet = await model.create(user.id);
    expect(wallet.user_id).toBe(user.id);
    expect(wallet.balance).toBe(0);
    expect(wallet.currency).toBe('INR');
  });

  it('findOrCreate is idempotent', async () => {
    const user = await createTestUser(db);
    const a = await model.findOrCreate(user.id);
    const b = await model.findOrCreate(user.id);
    expect(b.id).toBe(a.id);

    const rows = await db.query<{ c: number }>(
      'SELECT COUNT(*)::int AS c FROM wallets WHERE user_id = $1',
      [user.id],
    );
    expect(rows.rows[0].c).toBe(1);
  });

  it('credit increases balance', async () => {
    const user = await createTestUser(db);
    await model.findOrCreate(user.id);
    const after = await model.credit(user.id, 10_000);
    expect(after.balance).toBe(10_000);
    expect(await model.getBalance(user.id)).toBe(10_000);
  });

  it('credit throws for a missing wallet', async () => {
    const user = await createTestUser(db);
    await expect(model.credit(user.id, 100)).rejects.toThrow(/Wallet not found/);
  });

  it('debit decreases balance when sufficient funds', async () => {
    const user = await createTestUser(db);
    await model.findOrCreate(user.id);
    await model.credit(user.id, 5_000);
    const after = await model.debit(user.id, 2_000);
    expect(after.balance).toBe(3_000);
  });

  it('debit throws on insufficient balance and leaves balance unchanged', async () => {
    const user = await createTestUser(db);
    await model.findOrCreate(user.id);
    await model.credit(user.id, 500);
    await expect(model.debit(user.id, 1_000)).rejects.toThrow(/Insufficient/);
    expect(await model.getBalance(user.id)).toBe(500);
  });

  it('debit exactly at balance succeeds (boundary)', async () => {
    const user = await createTestUser(db);
    await model.findOrCreate(user.id);
    await model.credit(user.id, 1_000);
    const after = await model.debit(user.id, 1_000);
    expect(after.balance).toBe(0);
  });

  it('getBalance returns 0 for a user with no wallet', async () => {
    const user = await createTestUser(db);
    expect(await model.getBalance(user.id)).toBe(0);
  });

  it('concurrent debits: at least one rejects and balance never goes negative', async () => {
    const user = await createTestUser(db);
    await model.findOrCreate(user.id);
    await model.credit(user.id, 1_000);

    const results = await Promise.allSettled([
      model.debit(user.id, 600),
      model.debit(user.id, 600),
    ]);

    const rejected = results.filter((r) => r.status === 'rejected').length;
    expect(rejected).toBeGreaterThanOrEqual(1);

    expect(await model.getBalance(user.id)).toBeGreaterThanOrEqual(0);
  });
});
