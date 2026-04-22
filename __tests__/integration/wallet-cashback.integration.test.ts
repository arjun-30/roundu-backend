/**
 * Wallet + ledger integration tests against a real test Postgres. The
 * cashback service itself is still a stub, so these tests exercise the
 * wallet model that downstream cashback/referral flows call into.
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

describe('Wallet + ledger (integration)', () => {
  let db: Pool;
  let wallets: WalletModel;

  beforeAll(async () => {
    db = getTestPool();
    await waitForDb();
    await initTestSchema();
    wallets = new WalletModel(db);
  });

  beforeEach(async () => {
    await resetTestData();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('keeps wallet balance + ledger row consistent within a transaction', async () => {
    const user = await createTestUser(db);
    await wallets.findOrCreate(user.id);

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await wallets.credit(user.id, 100, client);
      await client.query(
        `INSERT INTO wallet_transactions (user_id, type, amount, currency, description)
         VALUES ($1, 'credit', $2, 'INR', $3)`,
        [user.id, 100, 'cashback'],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    expect(await wallets.getBalance(user.id)).toBe(100);
    const rows = await db.query<{ type: string; amount: string }>(
      'SELECT type, amount FROM wallet_transactions WHERE user_id = $1',
      [user.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].type).toBe('credit');
    expect(Number(rows.rows[0].amount)).toBe(100);
  });

  it('rolls back the wallet credit when the ledger insert fails', async () => {
    const user = await createTestUser(db);
    await wallets.findOrCreate(user.id);

    const client = await db.connect();
    let threw: unknown;
    try {
      await client.query('BEGIN');
      await wallets.credit(user.id, 500, client);
      try {
        await client.query(
          // invalid type violates check constraint → throws
          `INSERT INTO wallet_transactions (user_id, type, amount, currency, description)
           VALUES ($1, 'invalid_type', $2, 'INR', 'bad')`,
          [user.id, 500],
        );
      } catch (err) {
        threw = err;
        await client.query('ROLLBACK');
      }
    } finally {
      client.release();
    }

    expect(threw).toBeDefined();
    expect(await wallets.getBalance(user.id)).toBe(0);
  });

  it('credit + debit series reaches expected terminal balance', async () => {
    const user = await createTestUser(db);
    await wallets.findOrCreate(user.id);
    await wallets.credit(user.id, 1_000);
    await wallets.credit(user.id, 500);
    await wallets.debit(user.id, 300);
    await wallets.debit(user.id, 200);
    expect(await wallets.getBalance(user.id)).toBe(1_000);
  });
});
