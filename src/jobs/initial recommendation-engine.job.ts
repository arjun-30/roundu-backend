// DEV 3 — daily 2AM: load preferences + history, call vLLM, upsert recommendations
// src/jobs/recommendation-engine.job.ts
// Owner: Dev 3 (GPS + AI)
//
// Two modes:
//
//   A. SCHEDULED (nightly cron)
//      Every night at 02:00 IST, find all users who completed a booking in
//      the last 30 days and haven't had a recommendation run today.
//      Enqueue one 'generate' job per user.
//
//   B. EVENT-TRIGGERED (on booking completion)
//      When a booking reaches 'completed' status, booking.controller.ts calls
//      `enqueueRecommendationForUser(userId)` so recommendations update immediately
//      after a new data point arrives.
//
//   C. NOTIFICATION FLUSH (daily at 09:00 IST)
//      Find all predictions whose notify_on_date <= today and fire FCM pushes.
//      Calls the existing fcm.service via push-notification.job.ts pattern.
//
// Queue name : 'recommendation-engine'
// Job names  : 'generate' | 'flush-notifications' | 'expire-predictions'

import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { pool } from '../config/database';
import { RecommendationService } from '../services/recommendation.service';
import { PredictionModel } from '../models/prediction.model';
import { fcmService } from '../services/fcm.service';
import { logger } from '../utils/logger';

// ─── Job payload types ────────────────────────────────────────────────────────

interface GenerateJobData {
  userId: string;
}

interface FlushNotificationsJobData {
  triggeredAt: string; // ISO timestamp, for logging
}

interface ExpirePredictionsJobData {
  triggeredAt: string;
}

type RecommendationJobData =
  | ({ type: 'generate' } & GenerateJobData)
  | ({ type: 'flush-notifications' } & FlushNotificationsJobData)
  | ({ type: 'expire-predictions' } & ExpirePredictionsJobData);

// ─── Queue ────────────────────────────────────────────────────────────────────

export const recommendationQueue = new Queue<RecommendationJobData>(
  'recommendation-engine',
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  },
);

// ─── Public enqueue helpers ───────────────────────────────────────────────────

/**
 * Enqueue an immediate recommendation run for a single user.
 * Call this from booking.controller.ts when a booking is completed.
 */
export async function enqueueRecommendationForUser(userId: string): Promise<void> {
  await recommendationQueue.add(
    'generate',
    { type: 'generate', userId },
    {
      // Deduplicate: if a job for this user is already waiting, don't add another
      jobId: `generate:${userId}`,
      // Delay by 30 s to let the booking row fully commit before we read history
      delay: 30_000,
    },
  );
}

/**
 * Schedule the nightly batch job and daily notification flush.
 * Call this once from server.ts after the queue is created.
 */
export function scheduleRecurringJobs(): void {
  // Nightly batch: 02:00 IST = 20:30 UTC
  recommendationQueue.add(
    'nightly-batch',
    { type: 'generate', userId: '__batch__' }, // sentinel value handled in worker
    {
      repeat: { pattern: '30 20 * * *' }, // cron UTC
      jobId: 'nightly-batch',
    },
  );

  // Daily notification flush: 09:00 IST = 03:30 UTC
  recommendationQueue.add(
    'flush-notifications',
    { type: 'flush-notifications', triggeredAt: new Date().toISOString() },
    {
      repeat: { pattern: '30 3 * * *' },
      jobId: 'daily-flush-notifications',
    },
  );

  // Nightly prediction expiry: 01:00 IST = 19:30 UTC
  recommendationQueue.add(
    'expire-predictions',
    { type: 'expire-predictions', triggeredAt: new Date().toISOString() },
    {
      repeat: { pattern: '30 19 * * *' },
      jobId: 'nightly-expire-predictions',
    },
  );

  logger.info('Recommendation engine: recurring jobs scheduled');
}

// ─── Worker ───────────────────────────────────────────────────────────────────

let workerInstance: Worker<RecommendationJobData> | null = null;

export function startRecommendationWorker(): Worker<RecommendationJobData> {
  if (workerInstance) return workerInstance;

  const recommendationService = new RecommendationService(pool);
  const predictionModel = new PredictionModel(pool);

  workerInstance = new Worker<RecommendationJobData>(
    'recommendation-engine',
    async (job: Job<RecommendationJobData>) => {
      const data = job.data;

      // ── A. Per-user recommendation generation ────────────────────────────
      if (data.type === 'generate') {
        if (data.userId === '__batch__') {
          await runNightlyBatch(recommendationService);
        } else {
          await recommendationService.runForUser(data.userId);
        }
        return;
      }

      // ── B. Flush due notifications ────────────────────────────────────────
      if (data.type === 'flush-notifications') {
        await flushDueNotifications(predictionModel);
        return;
      }

      // ── C. Expire stale predictions ───────────────────────────────────────
      if (data.type === 'expire-predictions') {
        const expired = await predictionModel.expireStale();
        logger.info({ expired }, 'Recommendation engine: expired stale predictions');
        return;
      }
    },
    {
      connection: redisConnection,
      concurrency: 5, // run up to 5 user recommendation jobs in parallel
    },
  );

  workerInstance.on('completed', (job) => {
    logger.debug({ jobId: job.id, name: job.name }, 'Recommendation job completed');
  });

  workerInstance.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, name: job?.name, err }, 'Recommendation job failed');
  });

  logger.info('Recommendation engine worker started');
  return workerInstance;
}

export async function stopRecommendationWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = null;
  }
  await recommendationQueue.close();
  logger.info('Recommendation engine worker stopped');
}

// ─── Nightly batch handler ────────────────────────────────────────────────────

/**
 * Find all active users who completed a booking in the last 30 days
 * and enqueue an individual 'generate' job for each.
 * This keeps the batch job fast (just selects + enqueues) and distributes
 * the heavy vLLM inference work across the worker pool.
 */
async function runNightlyBatch(service: RecommendationService): Promise<void> {
  const { rows } = await pool.query<{ userId: string }>(
    `SELECT DISTINCT b.customer_id AS "userId"
     FROM bookings b
     WHERE b.status = 'completed'
       AND b.completed_at >= NOW() - INTERVAL '30 days'`,
  );

  logger.info({ userCount: rows.length }, 'Recommendation engine: nightly batch started');

  // Enqueue individual jobs so each user's vLLM call is independently retried
  const jobs = rows.map((r) => ({
    name: 'generate',
    data: { type: 'generate' as const, userId: r.userId },
    opts: {
      jobId: `generate:${r.userId}:${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5000 },
    },
  }));

  await recommendationQueue.addBulk(jobs);
  logger.info({ userCount: rows.length }, 'Recommendation engine: nightly batch enqueued');
}

// ─── Notification flush handler ───────────────────────────────────────────────

/**
 * Find all predictions due today and fire FCM push notifications.
 * Marks each as 'notified' before sending to prevent double-fire on retry.
 */
async function flushDueNotifications(predictionModel: PredictionModel): Promise<void> {
  const due = await predictionModel.findDueToday();
  logger.info({ count: due.length }, 'Recommendation engine: flushing due notifications');

  let sent = 0;
  let skipped = 0;

  for (const prediction of due) {
    if (!prediction.userFcmToken) {
      logger.debug({ userId: prediction.userId }, 'No FCM token — skipping notification');
      skipped++;
      continue;
    }

    // Mark notified BEFORE sending so a crash/retry doesn't send twice
    await predictionModel.markNotified(prediction.id);

    try {
      await fcmService.send({
        token: prediction.userFcmToken,
        title: `Time to book ${prediction.serviceName}! 🔔`,
        body: `Your ${prediction.serviceName} is due around ${formatDate(prediction.predictedServiceDate)}. Book now before slots fill up.`,
        data: {
          type: 'recommendation',
          serviceId: prediction.serviceId,
          predictionId: prediction.id,
          screen: 'ServiceDetail',
        },
      });
      sent++;
    } catch (err) {
      logger.error(
        { err, userId: prediction.userId, predictionId: prediction.id },
        'FCM send failed for prediction notification',
      );
      // Don't un-mark as notified — a failed send is still a send attempt;
      // better to miss once than spam the user on retry
    }
  }

  logger.info({ sent, skipped, total: due.length }, 'Recommendation engine: notification flush complete');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format "2025-09-15" → "Sep 15" */
function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}
