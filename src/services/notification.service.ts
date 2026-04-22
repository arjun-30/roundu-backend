// Owner: Dev 2 — Subscriptions + Notifications
import { Op } from 'sequelize';
import { Notification, NotificationType } from '../models/notification.model';
import { ScheduledNotification } from '../models/scheduled-notification.model';
import { sendToDevice } from './fcm.service';
import { getIO } from '../socket';
import { logger } from '../utils/logger';

// ─── User device token lookup ────────────────────────────────────────────────
// Call this once; cache result in Redis if high throughput is needed later.
async function getFcmToken(userId: string): Promise<string | null> {
  const { User } = await import('../models/user.model');
  const user = await User.findByPk(userId, { attributes: ['fcmToken'] });
  return user?.fcmToken ?? null;
}

// ─── Core notify() ───────────────────────────────────────────────────────────

export interface NotifyOptions {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Skip FCM push (e.g. in-app only, or user has push disabled) */
  skipPush?: boolean;
}

/**
 * The single entry point for ALL notifications in the system.
 * 1. Persists to DB → gives the user an inbox.
 * 2. Emits Socket.io event → real-time bell badge.
 * 3. Sends FCM push → device notification.
 */
export async function notify(opts: NotifyOptions): Promise<Notification> {
  // 1 — Persist
  const notification = await Notification.create({
    userId: opts.userId,
    type:   opts.type,
    title:  opts.title,
    body:   opts.body,
    data:   opts.data ?? {},
  });

  // 2 — Real-time socket
  try {
    getIO()
      .to(`user:${opts.userId}`)
      .emit('notification:new', { notificationId: notification.id, title: opts.title });
  } catch {
    // Socket might not be up in test environment — not a fatal error
  }

  // 3 — Push
  if (!opts.skipPush) {
    const token = await getFcmToken(opts.userId);
    if (token) {
      await sendToDevice(token, {
        title: opts.title,
        body:  opts.body,
        data:  Object.fromEntries(
          Object.entries(opts.data ?? {}).map(([k, v]) => [k, String(v)])
        ),
      });
    }
  }

  return notification;
}

// ─── Convenience shortcuts (called by other domains) ─────────────────────────

export const Notify = {
  bookingConfirmed: (userId: string, bookingId: string, serviceName: string) =>
    notify({
      userId, type: 'booking_confirmed',
      title: 'Booking confirmed',
      body:  `Your ${serviceName} booking has been confirmed.`,
      data:  { bookingId },
    }),

  bookingCancelled: (userId: string, bookingId: string, reason?: string) =>
    notify({
      userId, type: 'booking_cancelled',
      title: 'Booking cancelled',
      body:  reason ? `Your booking was cancelled: ${reason}` : 'Your booking has been cancelled.',
      data:  { bookingId },
    }),

  bookingReminder: (userId: string, bookingId: string, hoursAway: 24 | 1) =>
    notify({
      userId, type: hoursAway === 24 ? 'booking_reminder_24h' : 'booking_reminder_1h',
      title: 'Upcoming booking reminder',
      body:  `Your service is scheduled in ${hoursAway} hour${hoursAway > 1 ? 's' : ''}.`,
      data:  { bookingId },
    }),

  providerEnRoute: (userId: string, bookingId: string, providerName: string) =>
    notify({
      userId, type: 'provider_en_route',
      title: 'Provider on the way',
      body:  `${providerName} is heading to your location.`,
      data:  { bookingId },
    }),

  providerArrived: (userId: string, bookingId: string) =>
    notify({
      userId, type: 'provider_arrived',
      title: 'Provider has arrived',
      body:  'Your service provider has arrived at your location.',
      data:  { bookingId },
    }),

  serviceCompleted: (userId: string, bookingId: string) =>
    notify({
      userId, type: 'service_completed',
      title: 'Service completed',
      body:  'Your service is complete. Please leave a review!',
      data:  { bookingId },
    }),

  subscriptionActivated: (userId: string, planName: string, expiresAt: Date) =>
    notify({
      userId, type: 'subscription_activated',
      title: `${planName} activated`,
      body:  `Your ${planName} plan is now active until ${expiresAt.toLocaleDateString('en-IN')}.`,
    }),

  subscriptionExpiring: (userId: string, planName: string, daysLeft: number) =>
    notify({
      userId, type: 'subscription_expiring',
      title: 'Subscription expiring soon',
      body:  `Your ${planName} plan expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''}.`,
    }),

  subscriptionExpired: (userId: string, planName: string) =>
    notify({
      userId, type: 'subscription_expired',
      title: 'Subscription expired',
      body:  `Your ${planName} plan has expired. Renew to keep your benefits.`,
    }),

  walletCredited: (userId: string, amount: number) =>
    notify({
      userId, type: 'wallet_credited',
      title: 'Wallet credited',
      body:  `₹${amount} has been added to your wallet.`,
    }),
};

// ─── Scheduled notification processor ────────────────────────────────────────

/**
 * Called by reminder-notification.job.ts every minute.
 * Picks up pending scheduled notifications due in the past.
 */
export async function processDueScheduledNotifications(): Promise<void> {
  const due = await ScheduledNotification.findAll({
    where: {
      status:      'pending',
      scheduledAt: { [Op.lte]: new Date() },
    },
    limit: 100,
  });

  await Promise.allSettled(
    due.map(async (sn) => {
      try {
        await notify({
          userId: sn.userId,
          type:   'admin_broadcast',
          title:  sn.title,
          body:   sn.body,
          data:   sn.data as Record<string, unknown>,
        });
        await sn.update({ status: 'sent', sentAt: new Date() });
      } catch (err) {
        logger.error({ id: sn.id, err }, 'Failed to send scheduled notification');
        await sn.update({ status: 'failed' });
      }
    })
  );
}
