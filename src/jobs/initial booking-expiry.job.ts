// EXISTING — expire pending bookings after 10min
// Owner: Dev 4 — Real-time & Communications
// Purpose: BullMQ job — auto-cancel bookings that remain unconfirmed past the acceptance window

import { Job } from 'bullmq';
import { Op } from 'sequelize';
import { getQueue, registerWorker } from './queue';
import { emitBookingStatusChanged } from '../socket/emitters';
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────

export const BOOKING_EXPIRY_QUEUE = 'booking-expiry';

/** How long (ms) a booking can stay in "pending" before being auto-cancelled */
const ACCEPTANCE_WINDOW_MS = Number(process.env.BOOKING_ACCEPTANCE_WINDOW_MS ?? 10 * 60 * 1000); // 10 min

export interface BookingExpiryJobData {
  bookingId: string;
  userId: string;
  providerId?: string | null;
}

// ─── Enqueue helper ───────────────────────────────────────────────────────

/**
 * Schedule an expiry check for a newly created booking.
 * The job fires after ACCEPTANCE_WINDOW_MS; if the booking is still pending, it cancels it.
 */
export async function scheduleBookingExpiry(
  data: BookingExpiryJobData,
): Promise<void> {
  const queue = getQueue(BOOKING_EXPIRY_QUEUE);

  await queue.add('booking-expiry', data, {
    delay: ACCEPTANCE_WINDOW_MS,
    jobId: `expiry:${data.bookingId}`, // idempotent — one expiry job per booking
    removeOnComplete: true,
    removeOnFail: { count: 50 },
  });

  logger.info(
    `[BookingExpiryJob] Scheduled — booking=${data.bookingId} window=${ACCEPTANCE_WINDOW_MS}ms`,
  );
}

/**
 * Cancel the expiry job for a booking (e.g., provider accepted in time).
 */
export async function cancelBookingExpiry(bookingId: string): Promise<void> {
  const queue = getQueue(BOOKING_EXPIRY_QUEUE);
  const job = await queue.getJob(`expiry:${bookingId}`);

  if (job) {
    await job.remove();
    logger.info(`[BookingExpiryJob] Cancelled — booking=${bookingId}`);
  }
}

// ─── Worker ───────────────────────────────────────────────────────────────

export function startBookingExpiryWorker(): void {
  registerWorker(BOOKING_EXPIRY_QUEUE, async (job: Job<BookingExpiryJobData>) => {
    const { bookingId, userId } = job.data;

    // Lazy import to avoid circular deps at module load time
    const { Booking } = await import('../models/booking.model');

    const booking = await Booking.findByPk(bookingId);

    if (!booking) {
      logger.warn(`[BookingExpiryJob] Booking not found — id=${bookingId}`);
      return;
    }

    // Only expire if still in a cancellable pending state
    if (!['pending', 'confirmed'].includes(booking.status)) {
      logger.info(
        `[BookingExpiryJob] Skipped — booking=${bookingId} status=${booking.status}`,
      );
      return;
    }

    // Auto-cancel
    await booking.update({
      status: 'cancelled',
      cancellationReason: 'No provider accepted within the time window',
      cancelledAt: new Date(),
      cancelledBy: 'system',
    });

    // Notify all participants via WebSocket
    emitBookingStatusChanged(bookingId, 'cancelled', 'Booking expired — no provider accepted');

    logger.info(`[BookingExpiryJob] Auto-cancelled — booking=${bookingId} user=${userId}`);

    // Trigger refund if payment was captured (fire-and-forget; Stripe webhook confirms)
    void triggerRefundIfPaid(bookingId);
  });

  logger.info('[BookingExpiryJob] Worker started');
}

// ─── Sweep job (runs periodically as a cron safety net) ──────────────────

/**
 * Scan for any stale bookings that slipped through the per-booking job.
 * Run via a cron every 5 minutes.
 */
export async function sweepExpiredBookings(): Promise<void> {
  const { Booking } = await import('../models/booking.model');

  const cutoff = new Date(Date.now() - ACCEPTANCE_WINDOW_MS);

  const stale = await Booking.findAll({
    where: {
      status: 'pending',
      createdAt: { [Op.lt]: cutoff },
    },
    limit: 100,
  });

  if (stale.length === 0) return;

  logger.info(`[BookingExpirySweep] Found ${stale.length} stale bookings`);

  for (const booking of stale) {
    await booking.update({
      status: 'cancelled',
      cancellationReason: 'No provider accepted within the time window',
      cancelledAt: new Date(),
      cancelledBy: 'system',
    });

    emitBookingStatusChanged(
      booking.id,
      'cancelled',
      'Booking expired — no provider accepted',
    );

    void triggerRefundIfPaid(booking.id);
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────

async function triggerRefundIfPaid(bookingId: string): Promise<void> {
  try {
    const { Payment } = await import('../models/payment.model');
    const payment = await Payment.findOne({
      where: { bookingId, status: 'succeeded' },
    });

    if (!payment) return;

    // Import cancellation service lazily
    const { processRefund } = await import('../services/cancellation.service');
    await processRefund(payment.id, 'booking_expired');

    logger.info(`[BookingExpiryJob] Refund triggered — booking=${bookingId}`);
  } catch (err) {
    logger.error(`[BookingExpiryJob] Refund failed — booking=${bookingId}`, err);
  }
}
