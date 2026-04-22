// DEV 2 — every minute: find pending 1day+3hr notifications, send FCM push
// Owner: Dev 2 — Subscriptions + Notifications
import { Worker, Queue } from 'bullmq';
import { Op } from 'sequelize';
import { redisConnection } from '../config/redis';
import { Booking }        from '../models/booking.model';
import { Notify }         from '../services/notification.service';
import { processDueScheduledNotifications } from '../services/notification.service';
import { logger }         from '../utils/logger';

export const reminderQueue = new Queue('reminder-notifications', { connection: redisConnection });

export const reminderWorker = new Worker(
  'reminder-notifications',
  async () => {
    const now = new Date();

    // ── 24-hour reminders ──────────────────────────────────────────────────
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const window24 = { [Op.between]: [in24h, new Date(in24h.getTime() + 60_000)] };
    const bookings24 = await Booking.findAll({
      where: { status: 'confirmed', scheduledAt: window24 },
    });
    await Promise.allSettled(
      bookings24.map((b) => Notify.bookingReminder(b.userId, b.id, 24))
    );

    // ── 1-hour reminders ───────────────────────────────────────────────────
    const in1h = new Date(now.getTime() + 60 * 60 * 1000);
    const window1h = { [Op.between]: [in1h, new Date(in1h.getTime() + 60_000)] };
    const bookings1h = await Booking.findAll({
      where: { status: 'confirmed', scheduledAt: window1h },
    });
    await Promise.allSettled(
      bookings1h.map((b) => Notify.bookingReminder(b.userId, b.id, 1))
    );

    // ── Admin-scheduled notifications ──────────────────────────────────────
    await processDueScheduledNotifications();
  },
  { connection: redisConnection }
);

export async function startReminderScheduler() {
  await reminderQueue.add(
    'check-reminders',
    {},
    { repeat: { every: 60_000 } } // every 1 minute
  );
  logger.info('Reminder notification scheduler started');
}
