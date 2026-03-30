// DEV 3 — orchestrate vLLM + fallback rules
// src/services/recommendation.service.ts
// Owner: Dev 3 (GPS + AI)
//
// Orchestrates the full AI recommendation pipeline for a single user:
//   1. Fetch user's completed booking history from DB
//   2. Fetch all active services (what the model can recommend)
//   3. Call vLLM to generate ranked recommendations + predicted dates
//   4. Persist recommendations (recommendations table)
//   5. Upsert predictions (predictions table) — drives the push notification job
//   6. If vLLM is unavailable, fall back to a rule-based heuristic
//
// This service is called by the BullMQ job (recommendation-engine.job.ts).
// It is also called synchronously when GET /api/recommendations is hit but the
// user has no existing recommendations yet (on-demand generation).

import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { RecommendationModel } from '../models/recommendation.model';
import { PredictionModel } from '../models/prediction.model';
import { VllmService, VllmError, BookingHistoryEntry } from './vllm.service';
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActiveService {
  id: string;
  name: string;
  category: string;
  basePrice: number;
  averageIntervalDays: number | null; // from platform_settings or hardcoded defaults
}

// ─── Default service recurrence intervals (days) used by heuristic fallback ──

const DEFAULT_INTERVALS: Record<string, number> = {
  'AC Service':          180, // every 6 months
  'Cleaning':            30,  // monthly
  'Pest Control':        90,  // quarterly
  'Plumbing':            60,
  'Electrical':          60,
  'Painting':            365,
  'Carpentry':           180,
  'Water Purifier':      180,
  'Washing Machine':     180,
  'Refrigerator Repair': 365,
};

// ─── RecommendationService ────────────────────────────────────────────────────

export class RecommendationService {
  private readonly recommendationModel: RecommendationModel;
  private readonly predictionModel: PredictionModel;
  private readonly vllmService: VllmService;

  constructor(private readonly db: Pool) {
    this.recommendationModel = new RecommendationModel(db);
    this.predictionModel = new PredictionModel(db);
    this.vllmService = new VllmService();
  }

  /**
   * Main pipeline — run for a single user.
   * Called by recommendation-engine.job.ts.
   */
  async runForUser(userId: string): Promise<void> {
    logger.info({ userId }, 'Recommendation engine: starting for user');

    const [history, activeServices] = await Promise.all([
      this.fetchBookingHistory(userId),
      this.fetchActiveServices(),
    ]);

    // No point running if user has zero completed bookings
    if (!history.length) {
      logger.info({ userId }, 'Recommendation engine: no history — skipping');
      return;
    }

    const engineRunId = randomUUID();
    const today = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"

    let recommendations: Awaited<ReturnType<typeof this.vllmService.generateRecommendations>>;

    // ── Try AI path ──────────────────────────────────────────────────────────
    try {
      recommendations = await this.vllmService.generateRecommendations(
        history,
        activeServices,
        today,
      );
    } catch (err) {
      // ── Fallback: heuristic rule engine ────────────────────────────────────
      if (err instanceof VllmError) {
        logger.warn({ userId, err: err.message }, 'vLLM unavailable — using heuristic fallback');
        recommendations = this.heuristicFallback(history, activeServices, today);
      } else {
        throw err;
      }
    }

    // ── Persist recommendations ───────────────────────────────────────────────
    await this.recommendationModel.deleteOldRuns(userId, engineRunId);
    await this.recommendationModel.bulkCreate(
      recommendations.recommendations.map((r) => ({
        userId,
        serviceId: r.serviceId,
        reason: r.reason,
        score: r.score,
        predictedDate: r.predictedDate,
        engineRunId,
      })),
    );

    // ── Upsert predictions (drives FCM push notifications) ────────────────────
    for (const r of recommendations.recommendations) {
      try {
        await this.predictionModel.upsert({
          userId,
          serviceId: r.serviceId,
          predictedServiceDate: r.predictedDate,
          notifyDaysBefore: r.notifyDaysBefore,
          aiReasoning: r.aiReasoning,
          confidence: r.score,
        });
      } catch (err) {
        // One failed upsert must not abort the whole batch
        logger.error({ err, userId, serviceId: r.serviceId }, 'Failed to upsert prediction');
      }
    }

    logger.info(
      { userId, count: recommendations.recommendations.length, engineRunId },
      'Recommendation engine: completed',
    );
  }

  // ─── DB fetchers ────────────────────────────────────────────────────────────

  /**
   * Fetch the user's last 20 completed bookings with service info and rating.
   * Limited to 20 to keep the vLLM prompt within token budget.
   */
  private async fetchBookingHistory(userId: string): Promise<BookingHistoryEntry[]> {
    const { rows } = await this.db.query<BookingHistoryEntry>(
      `SELECT
         s.name           AS "serviceName",
         s.category       AS "serviceCategory",
         s.id             AS "serviceId",
         b.completed_at   AS "completedAt",
         r.rating
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       LEFT JOIN ratings r ON r.booking_id = b.id
       WHERE b.customer_id = $1
         AND b.status = 'completed'
         AND b.completed_at IS NOT NULL
       ORDER BY b.completed_at DESC
       LIMIT 20`,
      [userId],
    );
    return rows;
  }

  /**
   * Fetch all active services. Used to give the model a closed list
   * of valid service IDs — prevents hallucination.
   */
  private async fetchActiveServices(): Promise<ActiveService[]> {
    const { rows } = await this.db.query<ActiveService>(
      `SELECT
         id,
         name,
         category,
         base_price         AS "basePrice",
         duration_minutes   AS "averageIntervalDays"  -- misnamed in query; see note
       FROM services
       WHERE is_active = TRUE
       ORDER BY name`,
    );
    return rows;
  }

  // ─── Heuristic fallback ─────────────────────────────────────────────────────

  /**
   * Rule-based fallback when vLLM is unavailable.
   * Logic: for each distinct service in history, compute "last booked + interval = next date".
   * If next date is in the future, create a recommendation.
   */
  private heuristicFallback(
    history: BookingHistoryEntry[],
    activeServices: ActiveService[],
    today: string,
  ): Awaited<ReturnType<typeof this.vllmService.generateRecommendations>> {
    const seen = new Map<string, BookingHistoryEntry>(); // serviceId → most recent booking

    for (const entry of history) {
      if (!seen.has(entry.serviceId)) {
        seen.set(entry.serviceId, entry);
      }
    }

    const todayMs = new Date(today).getTime();
    const results: RecommendationInferenceResult['recommendations'] = [];

    for (const [serviceId, entry] of seen.entries()) {
      // Find interval for this service name (fuzzy match on keywords)
      const intervalDays =
        Object.entries(DEFAULT_INTERVALS).find(([key]) =>
          entry.serviceName.toLowerCase().includes(key.toLowerCase()),
        )?.[1] ?? 90; // default to 90-day interval if unknown

      const lastBookedMs = new Date(entry.completedAt).getTime();
      const nextDateMs = lastBookedMs + intervalDays * 86_400_000;

      if (nextDateMs <= todayMs) continue; // already overdue — still worth recommending

      const nextDate = new Date(nextDateMs).toISOString().split('T')[0];
      const daysUntil = Math.round((nextDateMs - todayMs) / 86_400_000);
      const score = Math.max(0.3, Math.min(0.85, 1 - daysUntil / 180)); // further = lower score

      results.push({
        serviceId,
        reason: `Time for your next ${entry.serviceName} — due in ${daysUntil} days.`,
        score,
        predictedDate: nextDate,
        notifyDaysBefore: 3,
        aiReasoning: `Heuristic: last booked ${entry.completedAt}, interval ${intervalDays} days`,
      });
    }

    // Sort by score descending, cap at 5
    results.sort((a, b) => b.score - a.score);

    return { recommendations: results.slice(0, 5) };
  }
}

// Re-export the type so the job can import it without going through vllm.service
type RecommendationInferenceResult = Awaited<
  ReturnType<VllmService['generateRecommendations']>
>;
