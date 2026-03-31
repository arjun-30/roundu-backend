// TECH LEAD / Dev 1 — OTP Model
// Handles all DB interactions for the otp_codes table.
// Never stores or returns plaintext OTPs — only bcrypt hashes.

import bcrypt from 'bcryptjs';
import { query, queryOne } from '../config/database';
import { logger } from '../utils/logger';

// ── Types ────────────────────────────────────────────────────────────────────

export type OtpPurpose = 'auth' | 'verify';

export interface OtpRow {
  id:         string;
  phone:      string;
  otp_hash:   string;
  purpose:    OtpPurpose;
  is_used:    boolean;
  attempts:   number;
  expires_at: Date;
  created_at: Date;
}

// Max wrong-guess attempts before the OTP is invalidated
const MAX_ATTEMPTS = 3;

// Bcrypt cost — high enough to slow brute-force but fast for single-verify use
const BCRYPT_ROUNDS = 10;

// OTP validity window in minutes
const OTP_EXPIRY_MINUTES = 10;

// ── create ───────────────────────────────────────────────────────────────────

/**
 * Hash the plaintext OTP and insert a fresh row.
 * Any previous unused OTPs for the same phone+purpose are marked expired
 * (by setting expires_at = NOW()) so only one active OTP exists at a time.
 */
export async function createOtp(
  phone:   string,
  otp:     string,          // plaintext — hashed before storage
  purpose: OtpPurpose = 'auth',
): Promise<OtpRow> {
  const otpHash = await bcrypt.hash(otp, BCRYPT_ROUNDS);

  // Expire any active OTPs for this phone+purpose first (prevents replay)
  await query(
    `UPDATE otp_codes
        SET expires_at = NOW()
      WHERE phone    = $1
        AND purpose  = $2
        AND is_used  = FALSE
        AND expires_at > NOW()`,
    [phone, purpose],
  );

  const rows = await query<OtpRow>(
    `INSERT INTO otp_codes (phone, otp_hash, purpose, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '${OTP_EXPIRY_MINUTES} minutes')
     RETURNING *`,
    [phone, otpHash, purpose],
  );

  logger.info('OTP created', { phone, purpose });
  return rows[0];
}

// ── findLatestValid ──────────────────────────────────────────────────────────

/**
 * Fetch the most recent, unused, unexpired OTP row for a phone+purpose.
 * Returns null if none exists.
 */
export async function findLatestValid(
  phone:   string,
  purpose: OtpPurpose = 'auth',
): Promise<OtpRow | null> {
  return queryOne<OtpRow>(
    `SELECT *
       FROM otp_codes
      WHERE phone      = $1
        AND purpose    = $2
        AND is_used    = FALSE
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1`,
    [phone, purpose],
  );
}

// ── verifyOtp ────────────────────────────────────────────────────────────────

export type VerifyResult =
  | { success: true;  row: OtpRow }
  | { success: false; reason: 'not_found' | 'expired' | 'max_attempts' | 'invalid' };

/**
 * Verify a plaintext OTP against the stored hash.
 *
 * - Increments the attempts counter on every wrong guess.
 * - Marks the row as used (is_used = TRUE) on success.
 * - Marks the row as used after MAX_ATTEMPTS wrong guesses (brute-force prevention).
 */
export async function verifyOtp(
  phone:   string,
  otp:     string,
  purpose: OtpPurpose = 'auth',
): Promise<VerifyResult> {
  const row = await findLatestValid(phone, purpose);

  if (!row) {
    return { success: false, reason: 'not_found' };
  }

  if (row.expires_at < new Date()) {
    return { success: false, reason: 'expired' };
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    await markUsed(row.id);
    return { success: false, reason: 'max_attempts' };
  }

  const match = await bcrypt.compare(otp, row.otp_hash);

  if (!match) {
    // Increment attempts counter
    await query(
      `UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`,
      [row.id],
    );

    // If this was the last allowed attempt, invalidate immediately
    const updatedAttempts = row.attempts + 1;
    if (updatedAttempts >= MAX_ATTEMPTS) {
      await markUsed(row.id);
    }

    logger.warn('OTP mismatch', { phone, purpose, attempts: updatedAttempts });
    return { success: false, reason: 'invalid' };
  }

  // ✅ Correct — mark as used
  const used = await markUsed(row.id);
  logger.info('OTP verified successfully', { phone, purpose });
  return { success: true, row: used };
}

// ── markUsed ─────────────────────────────────────────────────────────────────

/**
 * Mark an OTP row as consumed. Called by verifyOtp internally,
 * but exported so the auth controller can also call it directly if needed.
 */
export async function markUsed(id: string): Promise<OtpRow> {
  const rows = await query<OtpRow>(
    `UPDATE otp_codes
        SET is_used = TRUE
      WHERE id = $1
      RETURNING *`,
    [id],
  );
  return rows[0];
}

// ── deleteExpired ─────────────────────────────────────────────────────────────

/**
 * Hard-delete OTP rows older than `olderThanMinutes`.
 * Called by the cleanup job (src/jobs/cleanup.job.ts) on a schedule.
 */
export async function deleteExpiredOtps(olderThanMinutes = 60): Promise<number> {
  const rows = await query<{ count: string }>(
    `WITH deleted AS (
       DELETE FROM otp_codes
        WHERE expires_at < NOW() - INTERVAL '${olderThanMinutes} minutes'
        RETURNING id
     )
     SELECT COUNT(*) AS count FROM deleted`,
  );
  const count = parseInt(rows[0]?.count ?? '0', 10);
  if (count > 0) {
    logger.info('Expired OTPs cleaned up', { count });
  }
  return count;
}
