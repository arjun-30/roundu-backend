// Owner: Dev 4 — Referrals + Offers + Portfolio + Tracking
// Service: referral.service.ts

import { Pool } from 'pg';
import { ReferralCode, ReferralEvent } from '../models/referral.model';

const REWARD_AMOUNT = 50;     // INR credit per successful referral
const REWARD_CURRENCY = 'INR';
const BASE_SHARE_URL = process.env.APP_BASE_URL ?? 'https://roundu.app';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derives a deterministic referral code from the user's name + id suffix */
function deriveCode(name: string, userId: string): string {
  const namePart = name.replace(/\s+/g, '').toUpperCase().slice(0, 8);
  const idPart = userId.replace(/-/g, '').slice(0, 4).toUpperCase();
  return `${namePart}${idPart}`;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Return (or lazily create) the referral code row for a user.
 * The code is stored in a `referral_codes` table keyed by user_id.
 */
export async function getOrCreateReferralCode(
  db: Pool,
  userId: string,
): Promise<ReferralCode> {
  // Try to fetch existing code
  const existing = await db.query<{
    code: string;
    total_earned: number;
    total_referrals: number;
  }>(
    `SELECT rc.code,
            COALESCE(SUM(r.reward_amount), 0)::int AS total_earned,
            COUNT(r.id)::int                        AS total_referrals
     FROM referral_codes rc
     LEFT JOIN referrals r
       ON r.code = rc.code AND r.status = 'settled'
     WHERE rc.user_id = $1
     GROUP BY rc.code`,
    [userId],
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    return {
      userId,
      code: row.code,
      shareUrl: `${BASE_SHARE_URL}/join?ref=${row.code}`,
      totalEarned: row.total_earned,
      totalReferrals: row.total_referrals,
    };
  }

  // Lazily create a code using the user's name
  const userRow = await db.query<{ name: string }>(
    'SELECT name FROM users WHERE id = $1',
    [userId],
  );

  const code = deriveCode(userRow.rows[0]?.name ?? 'USER', userId);

  await db.query(
    'INSERT INTO referral_codes (user_id, code) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, code],
  );

  return {
    userId,
    code,
    shareUrl: `${BASE_SHARE_URL}/join?ref=${code}`,
    totalEarned: 0,
    totalReferrals: 0,
  };
}

/**
 * Apply a referral code for the authenticated user.
 *
 * Rules:
 *  - Code must exist
 *  - User cannot apply their own code
 *  - User cannot apply a code more than once
 *  - Credits both referrer and referred user wallets (via wallet_transactions)
 */
export async function applyReferralCode(
  db: Pool,
  referredId: string,
  code: string,
): Promise<{ rewardAmount: number; currency: string }> {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // 1. Resolve code → referrer
    const codeRow = await client.query<{ user_id: string }>(
      'SELECT user_id FROM referral_codes WHERE code = $1',
      [code],
    );

    if (codeRow.rows.length === 0) {
      throw Object.assign(new Error('Invalid or expired referral code'), {
        statusCode: 400,
        code: 'INVALID_REFERRAL_CODE',
      });
    }

    const referrerId = codeRow.rows[0].user_id;

    // 2. Cannot self-refer
    if (referrerId === referredId) {
      throw Object.assign(new Error('You cannot apply your own referral code'), {
        statusCode: 400,
        code: 'SELF_REFERRAL',
      });
    }

    // 3. Already used?
    const duplicate = await client.query(
      'SELECT id FROM referrals WHERE referred_id = $1',
      [referredId],
    );

    if (duplicate.rows.length > 0) {
      throw Object.assign(new Error('Referral code already used'), {
        statusCode: 409,
        code: 'CONFLICT',
      });
    }

    // 4. Create referral record
    await client.query(
      `INSERT INTO referrals (referrer_id, referred_id, code, reward_amount, currency, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [referrerId, referredId, code, REWARD_AMOUNT, REWARD_CURRENCY],
    );

    // 5. Credit both wallets
    const creditWallet = async (userId: string, amount: number, description: string) => {
      await client.query(
        `UPDATE wallets SET balance = balance + $1 WHERE user_id = $2`,
        [amount, userId],
      );
      await client.query(
        `INSERT INTO wallet_transactions (user_id, type, amount, currency, description)
         VALUES ($1, 'credit', $2, $3, $4)`,
        [userId, amount, REWARD_CURRENCY, description],
      );
    };

    await creditWallet(referrerId, REWARD_AMOUNT, `Referral reward — code ${code}`);
    await creditWallet(referredId, REWARD_AMOUNT, `Welcome bonus — joined via referral`);

    // 6. Mark settled
    await client.query(
      `UPDATE referrals SET status = 'settled', settled_at = NOW()
       WHERE referred_id = $1 AND code = $2`,
      [referredId, code],
    );

    await client.query('COMMIT');

    return { rewardAmount: REWARD_AMOUNT, currency: REWARD_CURRENCY };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Return the referral history for a user (as the referrer).
 */
export async function getReferralHistory(
  db: Pool,
  userId: string,
  page: number,
  limit: number,
): Promise<{ data: ReferralEvent[]; total: number }> {
  const offset = (page - 1) * limit;

  const [rows, countRow] = await Promise.all([
    db.query<{
      id: string;
      referred_name: string;
      reward_amount: number;
      currency: string;
      status: string;
      created_at: Date;
    }>(
      `SELECT r.id,
              u.name  AS referred_name,
              r.reward_amount,
              r.currency,
              r.status,
              r.created_at
       FROM referrals r
       JOIN users u ON u.id = r.referred_id
       WHERE r.referrer_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
    db.query<{ count: string }>(
      'SELECT COUNT(*) FROM referrals WHERE referrer_id = $1',
      [userId],
    ),
  ]);

  return {
    data: rows.rows.map((r) => ({
      id: r.id,
      referredName: r.referred_name,
      rewardAmount: r.reward_amount,
      currency: r.currency,
      status: r.status as any,
      createdAt: r.created_at,
    })),
    total: parseInt(countRow.rows[0].count, 10),
  };
}