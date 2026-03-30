// DEV 2 — daily: find active subs due, auto-create bookings, schedule notifications
// Owner: Dev 2 — Subscriptions + Notifications
import { Worker, Queue } from 'bullmq';
import { redisConnection } from '../config/redis';
import { expireStaleSubscriptions, getSubscriptionsExpiringIn } from '../services/subscription.service';
import { Notify } from '../services/notification.service';
import { logger } from '../utils/logger';

export const subscriptionQueue = new Queue('subscription-scheduler', { connection: redisConnection });

export const subscriptionWorker = new Worker(
  'subscription-scheduler',
  async () => {
    // 1 — Expire stale subscriptions
    const expired = await expireStaleSubscriptions();
    if (expired > 0) logger.info(`Expired ${expired} subscriptions`);

    // 2 — Warn users expiring in 3 days
    const expiring3 = await getSubscriptionsExpiringIn(3);
    await Promise.allSettled(
      expiring3.map((sub) =>
        Notify.subscriptionExpiring(sub.userId, sub.plan!.name, 3)
      )
    );

    // 3 — Final warning: expiring tomorrow
    const expiring1 = await getSubscriptionsExpiringIn(1);
    await Promise.allSettled(
      expiring1.map((sub) =>
        Notify.subscriptionExpiring(sub.userId, sub.plan!.name, 1)
      )
    );
  },
  { connection: redisConnection }
);

/** Call once at app startup to register the repeating job */
export async function startSubscriptionScheduler() {
  await subscriptionQueue.add(
    'check-subscriptions',
    {},
    { repeat: { every: 60 * 60 * 1000 } } // every hour
  );
  logger.info('Subscription scheduler started');
}
