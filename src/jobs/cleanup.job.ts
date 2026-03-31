// EXISTING — delete expired OTPs, old notifications, old GPS logs >90 days
import { createWorker, scheduleRepeatable } from './queue';
import { execute } from '../config/database';
import { logger } from '../utils/logger';

// ── Job Data (empty — no payload needed for cleanup) ────────────────────────
interface CleanupJobData {}

// ── Register Worker ─────────────────────────────────────────────────────────
export function startCleanupWorker() {
  createWorker<CleanupJobData>('cleanup', async (_job) => {
    const results: Record<string, number> = {};

    // 1. Delete expired OTP codes (older than 1 hour)
    results.otpCodes = await execute(
      "DELETE FROM otp_codes WHERE expires_at < NOW() - INTERVAL '1 hour'",
    );

    // 2. Delete old read notifications (older than 90 days)
    results.notifications = await execute(
      "DELETE FROM notifications WHERE is_read = true AND created_at < NOW() - INTERVAL '90 days'",
    );

    // 3. Delete old GPS logs (older than 90 days — keep recent for analysis)
    results.gpsLogs = await execute(
      "DELETE FROM gps_logs WHERE logged_at < NOW() - INTERVAL '90 days'",
    );

    // 4. Delete expired offers
    results.expiredOffers = await execute(
      "UPDATE offers SET is_active = false WHERE expires_at < NOW() AND is_active = true",
    );

    // 5. Delete orphaned wallet transactions older than 2 years
    results.oldWalletTx = await execute(
      "DELETE FROM wallet_transactions WHERE created_at < NOW() - INTERVAL '2 years'",
    );

    // 6. Delete completed call logs older than 6 months
    results.callLogs = await execute(
      "DELETE FROM call_logs WHERE created_at < NOW() - INTERVAL '6 months' AND status IN ('completed', 'failed')",
    );

    // 7. Delete old sent scheduled notifications
    results.sentNotifications = await execute(
      "DELETE FROM scheduled_notifications WHERE sent = true AND send_at < NOW() - INTERVAL '30 days'",
    );

    logger.info('Cleanup job completed', { deleted: results });
  });
}

// ── Schedule: runs daily at 3 AM ────────────────────────────────────────────
export async function scheduleCleanup() {
  await scheduleRepeatable('cleanup', {}, '0 3 * * *');
}
