// EXISTING — async FCM send + stale token cleanup
// Owner: Dev 2 — Subscriptions + Notifications
import { Worker, Queue } from 'bullmq';
import { redisConnection } from '../config/redis';
import { sendToDevice, FcmPayload } from '../services/fcm.service';
import { logger } from '../utils/logger';

interface PushJob { token: string; payload: FcmPayload; }

export const pushQueue = new Queue<PushJob>('push-notifications', { connection: redisConnection });

export const pushWorker = new Worker<PushJob>(
  'push-notifications',
  async (job) => {
    await sendToDevice(job.data.token, job.data.payload);
  },
  { connection: redisConnection, concurrency: 20 }
);

pushWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Push notification job failed');
});

/** Enqueue a push — use this instead of calling sendToDevice() directly when not in a job context */
export async function enqueuePush(token: string, payload: FcmPayload): Promise<void> {
  await pushQueue.add('send', { token, payload }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
}
