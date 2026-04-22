// TECH LEAD — BullMQ queue instances + createWorker factory
// Owner: Dev 4 — Real-time & Communications
// Purpose: BullMQ queue factory — shared queue/worker registry with Redis connection

import { Queue, Worker, Processor, WorkerOptions } from 'bullmq';
import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';

const queues = new Map<string, Queue>();
const workers = new Map<string, Worker>();

/**
 * Get or create a BullMQ Queue by name.
 */
export function getQueue(name: string): Queue {
  if (!queues.has(name)) {
    queues.set(
      name,
      new Queue(name, {
        connection: redisConnection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      }),
    );
    logger.debug(`[Queue] Created queue: ${name}`);
  }

  return queues.get(name)!;
}

/**
 * Register a worker for a named queue.
 * Idempotent — calling twice with the same name is a no-op.
 */
export function registerWorker<T = any>(
  queueName: string,
  processor: Processor<T>,
  opts: Partial<WorkerOptions> = {},
): Worker<T> {
  if (workers.has(queueName)) {
    return workers.get(queueName) as Worker<T>;
  }

  const worker = new Worker<T>(queueName, processor, {
    connection: redisConnection,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
    ...opts,
  });

  worker.on('failed', (job, err) => {
    logger.error(`[Worker:${queueName}] Job ${job?.id} failed`, err);
  });

  worker.on('completed', (job) => {
    logger.debug(`[Worker:${queueName}] Job ${job.id} completed`);
  });

  workers.set(queueName, worker);
  return worker;
}

/**
 * Gracefully close all queues and workers.
 * Call during SIGTERM handling.
 */
export async function closeAllQueues(): Promise<void> {
  await Promise.all([
    ...[...workers.values()].map((w) => w.close()),
    ...[...queues.values()].map((q) => q.close()),
  ]);
  logger.info('[Queue] All queues and workers closed');
}
