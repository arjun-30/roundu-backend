// EXISTING — recalculate rating_avg, completion_rate, response_rate
import { createWorker, scheduleRepeatable } from './queue';
import { execute, queryMany } from '../config/database';
import { logger } from '../utils/logger';

// ── Job Data ────────────────────────────────────────────────────────────────
interface ProviderStatsJobData {
  providerId?: string; // If set, recalculate only this provider. If null, recalculate all.
}

// ── Register Worker ─────────────────────────────────────────────────────────
export function startProviderStatsWorker() {
  createWorker<ProviderStatsJobData>('provider-stats', async (job) => {
    const { providerId } = job.data;

    if (providerId) {
      // Recalculate a single provider (triggered after a booking completes or rating is submitted)
      await recalculateProvider(providerId);
      return;
    }

    // Recalculate ALL providers (nightly batch)
    const providers = await queryMany<{ id: string }>('SELECT id FROM providers WHERE is_approved = true');

    let updated = 0;
    for (const p of providers) {
      await recalculateProvider(p.id);
      updated++;
    }

    logger.info('Provider stats batch completed', { providersUpdated: updated });
  });
}

// ── Core recalculation logic ────────────────────────────────────────────────
async function recalculateProvider(providerId: string): Promise<void> {
  // 1. Rating average + count
  const ratingRow = await queryMany<{ avg: string; count: string }>(
    `SELECT
       COALESCE(AVG(r.score), 0) as avg,
       COUNT(r.id) as count
     FROM ratings r
     JOIN bookings b ON r.booking_id = b.id
     WHERE b.provider_id = $1`,
    [providerId],
  );
  const ratingAvg = parseFloat(ratingRow[0]?.avg ?? '0');
  const ratingCount = parseInt(ratingRow[0]?.count ?? '0', 10);

  // 2. Total completed bookings
  const completedRow = await queryMany<{ count: string }>(
    `SELECT COUNT(*) as count FROM bookings
     WHERE provider_id = $1 AND status IN ('completed', 'paid')`,
    [providerId],
  );
  const completedCount = parseInt(completedRow[0]?.count ?? '0', 10);

  // 3. Total assigned bookings (accepted or later)
  const assignedRow = await queryMany<{ count: string }>(
    `SELECT COUNT(*) as count FROM bookings
     WHERE provider_id = $1 AND status NOT IN ('pending', 'rejected')`,
    [providerId],
  );
  const assignedCount = parseInt(assignedRow[0]?.count ?? '0', 10);

  // 4. Completion rate
  const completionRate = assignedCount > 0 ? (completedCount / assignedCount) * 100 : 0;

  // 5. Response rate (accepted / (accepted + rejected + expired))
  const responseRow = await queryMany<{ accepted: string; total: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE status NOT IN ('pending', 'rejected', 'expired')) as accepted,
       COUNT(*) as total
     FROM bookings
     WHERE provider_id = $1`,
    [providerId],
  );
  const acceptedCount = parseInt(responseRow[0]?.accepted ?? '0', 10);
  const totalOffered = parseInt(responseRow[0]?.total ?? '0', 10);
  const responseRate = totalOffered > 0 ? (acceptedCount / totalOffered) * 100 : 0;

  // 6. Total earnings (net — after platform fee)
  const earningsRow = await queryMany<{ total: string }>(
    `SELECT COALESCE(SUM(quoted_amount), 0) as total
     FROM bookings
     WHERE provider_id = $1 AND payment_status = 'paid'`,
    [providerId],
  );
  const totalEarnings = parseInt(earningsRow[0]?.total ?? '0', 10);

  // 7. Update provider record
  await execute(
    `UPDATE providers SET
       rating_avg = $1,
       rating_count = $2,
       total_jobs = $3,
       completion_rate = $4,
       response_rate = $5,
       total_earnings = $6,
       stats_updated_at = NOW()
     WHERE id = $7`,
    [
      Math.round(ratingAvg * 10) / 10, // 1 decimal place
      ratingCount,
      completedCount,
      Math.round(completionRate * 10) / 10,
      Math.round(responseRate * 10) / 10,
      totalEarnings,
      providerId,
    ],
  );
}

// ── Schedule: runs every night at 2 AM ──────────────────────────────────────
export async function scheduleProviderStats() {
  await scheduleRepeatable('provider-stats', {}, '0 2 * * *');
}

// ── Export for on-demand use ─────────────────────────────────────────────────
// When a booking completes or a rating is submitted, enqueue:
//   enqueue('provider-stats', { providerId: 'xxx' });
export { recalculateProvider };
