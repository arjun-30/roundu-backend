// DEV 3 — every 15min: analyze provider GPS vs customer addresses, flag off-app servicing
// src/jobs/gps-analysis.job.ts
// Owner: Dev 3 (GPS + AI)
//
// BullMQ queue + worker for asynchronous GPS analysis.
// This decouples the geofence/anomaly checks from the HTTP request path so the
// provider gets an immediate 200 OK on every location ping.
//
// Queue name : 'gps-analysis'
// Job name   : 'analyse'
// Concurrency: 10 (tune based on CPU cores available)

import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { pool } from '../config/database';
import { GpsMonitorService, MonitorContext } from '../services/gps-monitor.service';
import { logger } from '../utils/logger';

// ─── Job payload type ─────────────────────────────────────────────────────────

export interface GpsAnalysisJobData extends MonitorContext {}

// ─── Queue (exported — used by TrackingService to enqueue jobs) ───────────────

export const gpsAnalysisQueue = new Queue<GpsAnalysisJobData>('gps-analysis', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2 s → 4 s → 8 s
    },
    removeOnComplete: true,  // don't accumulate completed jobs in Redis
    removeOnFail: false,     // keep failed jobs for debugging
  },
});

// ─── Worker (started once in server.ts) ──────────────────────────────────────

let workerInstance: Worker<GpsAnalysisJobData> | null = null;

export function startGpsAnalysisWorker(): Worker<GpsAnalysisJobData> {
  if (workerInstance) return workerInstance;

  const monitor = new GpsMonitorService(pool);

  workerInstance = new Worker<GpsAnalysisJobData>(
    'gps-analysis',
    async (job: Job<GpsAnalysisJobData>) => {
      const ctx = job.data;

      logger.debug(
        {
          jobId: job.id,
          sessionId: ctx.sessionId,
          bookingId: ctx.bookingId,
        },
        'GPS analysis job processing',
      );

      await monitor.analyse(ctx);
    },
    {
      connection: redisConnection,
      concurrency: 10, // process up to 10 pings in parallel
    },
  );

  workerInstance.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'GPS analysis job completed');
  });

  workerInstance.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, err },
      'GPS analysis job failed',
    );
  });

  logger.info('GPS analysis worker started (concurrency=10)');
  return workerInstance;
}

/**
 * Graceful shutdown — called from process SIGTERM handler in server.ts.
 */
export async function stopGpsAnalysisWorker(): Promise<void> {
  if (workerInstance) {
    await workerInstance.close();
    workerInstance = null;
    logger.info('GPS analysis worker stopped');
  }
  await gpsAnalysisQueue.close();
}
