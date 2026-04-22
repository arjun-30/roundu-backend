// DEV 1 — after payment: credit 5% cashback to customer wallet

import { Job } from 'bullmq';
import { CashbackService } from '../services/cashback.service';
import { db } from '../config/database';
import { logger } from '../utils/logger';
import { cashbackQueue, createWorker } from './queue';

export interface CashbackJobData {
  bookingId: string;
  userId: string;
  paidPaise: number;
  stripeIntentId?: string;
}

export const CASHBACK_JOB_NAME = 'credit-cashback';

const cashbackService = new CashbackService(db);

/**
 * Enqueue a cashback credit job.
 * Called by the webhook controller after payment_intent.succeeded.
 */
export async function enqueueCashbackJob(data: CashbackJobData): Promise<void> {
  await cashbackQueue.add(CASHBACK_JOB_NAME, data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 100 },
  });
}

/**
 * Worker that processes cashback jobs.
 * Start this worker in server.ts alongside other workers.
 */
export const cashbackWorker = createWorker<CashbackJobData>(
  'cashback',
  async (job: Job<CashbackJobData>) => {
    const { bookingId, userId, paidPaise, stripeIntentId } = job.data;

    logger.info('Processing cashback job', { jobId: job.id, bookingId, userId });

    const result = await cashbackService.creditCashback(
      bookingId,
      userId,
      paidPaise,
      stripeIntentId
    );

    logger.info('Cashback credited', {
      jobId: job.id,
      bookingId,
      cashbackPaise: result.cashbackPaise,
    });

    return result;
  }
);

cashbackWorker.on('failed', (job, err) => {
  logger.error('Cashback job failed', {
    jobId: job?.id,
    bookingId: job?.data?.bookingId,
    error: err.message,
    attemptsMade: job?.attemptsMade,
  });
});
