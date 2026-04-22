import type { Pool, PoolClient } from 'pg';
import {
  getOrCreateReferralCode,
  applyReferralCode,
  getReferralHistory,
} from '../../src/services/referral.service';

interface QueryResult<T = unknown> {
  rows: T[];
}
type QueryResponder = (sql: string, params?: unknown[]) => Promise<QueryResult>;

function makeMockPool(responder: QueryResponder): Pool {
  return {
    query: jest.fn(responder as any),
  } as unknown as Pool;
}

function makeMockPoolWithClient(clientResponder: QueryResponder): {
  pool: Pool;
  calls: Array<{ sql: string; params?: unknown[] }>;
} {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return clientResponder(sql, params);
    }),
    release: jest.fn(),
  } as unknown as PoolClient;

  const pool = {
    connect: jest.fn(async () => client),
  } as unknown as Pool;

  return { pool, calls };
}

describe('getOrCreateReferralCode', () => {
  it('returns existing code + aggregated earnings', async () => {
    const pool = makeMockPool(async (sql) => {
      if (sql.includes('FROM referral_codes rc'))
        return { rows: [{ code: 'ARJUN1234', total_earned: 150, total_referrals: 3 }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await getOrCreateReferralCode(pool, 'user-1');
    expect(result).toMatchObject({
      userId: 'user-1',
      code: 'ARJUN1234',
      totalEarned: 150,
      totalReferrals: 3,
    });
    expect(result.shareUrl).toContain('ARJUN1234');
  });

  it('lazily creates a deterministic code when none exists', async () => {
    const userId = 'abcd1234-aaaa-bbbb-cccc-000000000000';
    let inserted: { code?: string } = {};

    const pool = makeMockPool(async (sql, params) => {
      if (sql.includes('FROM referral_codes rc')) return { rows: [] };
      if (sql.includes('FROM users WHERE id')) return { rows: [{ name: 'Arjun R' }] };
      if (sql.includes('INSERT INTO referral_codes')) {
        inserted.code = params?.[1] as string;
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await getOrCreateReferralCode(pool, userId);
    expect(result.code).toBe('ARJUNRABCD');
    expect(inserted.code).toBe('ARJUNRABCD');
  });

  it('falls back to USER prefix when user row missing', async () => {
    const userId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const pool = makeMockPool(async (sql) => {
      if (sql.includes('FROM referral_codes rc')) return { rows: [] };
      if (sql.includes('FROM users WHERE id')) return { rows: [] };
      if (sql.includes('INSERT INTO referral_codes')) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const r = await getOrCreateReferralCode(pool, userId);
    expect(r.code).toBe('USERFFFF');
  });
});

describe('applyReferralCode', () => {
  it('rejects a non-existent code with INVALID_REFERRAL_CODE', async () => {
    const { pool, calls } = makeMockPoolWithClient(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM referral_codes WHERE code')) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(applyReferralCode(pool, 'u2', 'UNKNOWN')).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_REFERRAL_CODE',
    });
    expect(calls.some((c) => c.sql === 'ROLLBACK')).toBe(true);
  });

  it('rejects self-referral with SELF_REFERRAL', async () => {
    const { pool } = makeMockPoolWithClient(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM referral_codes WHERE code'))
        return { rows: [{ user_id: 'same' }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(applyReferralCode(pool, 'same', 'ANY')).rejects.toMatchObject({
      statusCode: 400,
      code: 'SELF_REFERRAL',
    });
  });

  it('rejects duplicate application with CONFLICT', async () => {
    const { pool } = makeMockPoolWithClient(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM referral_codes WHERE code'))
        return { rows: [{ user_id: 'referrer' }] };
      if (sql.includes('FROM referrals WHERE referred_id'))
        return { rows: [{ id: 'prev' }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(applyReferralCode(pool, 'u2', 'CODE1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
  });

  it('commits on success and credits both wallets', async () => {
    const { pool, calls } = makeMockPoolWithClient(async (sql) => {
      if (['BEGIN', 'COMMIT'].includes(sql)) return { rows: [] };
      if (sql.includes('FROM referral_codes WHERE code'))
        return { rows: [{ user_id: 'referrer' }] };
      if (sql.includes('FROM referrals WHERE referred_id')) return { rows: [] };
      if (sql.includes('INSERT INTO referrals')) return { rows: [] };
      if (sql.startsWith('UPDATE wallets')) return { rows: [] };
      if (sql.includes('INSERT INTO wallet_transactions')) return { rows: [] };
      if (sql.startsWith(`UPDATE referrals SET status = 'settled'`)) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await applyReferralCode(pool, 'u2', 'CODE1');
    expect(result).toEqual({ rewardAmount: 50, currency: 'INR' });

    expect(calls.filter((c) => c.sql.startsWith('UPDATE wallets')).length).toBe(2);
    expect(
      calls.filter((c) => c.sql.includes('INSERT INTO wallet_transactions')).length,
    ).toBe(2);
    expect(calls.some((c) => c.sql === 'COMMIT')).toBe(true);
    expect(calls.every((c) => c.sql !== 'ROLLBACK')).toBe(true);
  });
});

describe('getReferralHistory', () => {
  it('computes offset from page/limit and maps rows', async () => {
    let capturedOffset: unknown;
    const pool = makeMockPool(async (sql, params) => {
      if (sql.includes('JOIN users u')) {
        capturedOffset = params?.[2];
        return {
          rows: [
            {
              id: 'r1',
              referred_name: 'Bob',
              reward_amount: 50,
              currency: 'INR',
              status: 'settled',
              created_at: new Date('2026-04-10T00:00:00Z'),
            },
          ],
        };
      }
      if (sql.includes('SELECT COUNT(*) FROM referrals'))
        return { rows: [{ count: '1' }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const r = await getReferralHistory(pool, 'user-1', 3, 10);
    expect(capturedOffset).toBe(20);
    expect(r.total).toBe(1);
    expect(r.data[0]).toMatchObject({
      id: 'r1',
      referredName: 'Bob',
      rewardAmount: 50,
      status: 'settled',
    });
  });
});
