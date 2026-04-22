// src/services/payment.service.ts
// Owner: Dev 2 — Payment Service
//
// Orchestrates the full post-payment flow:
//   1. Verify payment succeeded on Stripe (server-side check)
//   2. Update booking status and payment_status
//   3. Credit provider earnings to their wallet
//   4. Trigger cashback for the user
//   5. Schedule FCM push notifications (queued via BullMQ)
//
// This service is called by:
//   - webhook.controller.ts after payment_intent.succeeded
//   - booking.controller.ts when a booking is created with wallet payment

import Stripe from 'stripe';
import { db } from '../config/database';
import { retrievePaymentIntent } from './stripe.service';
import { creditCashback } from './cashback.service';
import { creditWallet, debitWallet } from './wallet.service';
import { findPaymentByIntentId, updatePaymentByIntentId } from '../models/payment.model';
import { logger } from '../utils/logger';
import { paymentConfirmedQueue } from '../jobs/queue';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BookingPaymentResult {
  bookingId: string;
  paymentId: string;
  status: 'confirmed' | 'already_processed';
  cashback?: { amount: number; transactionId?: string };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch full booking row including provider and user details.
 */
async function getBookingWithDetails(bookingId: string) {
  const { rows } = await db.query(
    `SELECT
       b.id,
       b.user_id,
       b.provider_id,
       b.total_amount,
       b.status,
       b.payment_status,
       b.service_id,
       u.name  AS user_name,
       u.phone AS user_phone,
       p.user_id AS provider_user_id
     FROM bookings b
     JOIN users    u ON u.id = b.user_id
     JOIN providers p ON p.id = b.provider_id
     WHERE b.id = $1`,
    [bookingId],
  );
  return rows[0] ?? null;
}

/**
 * Get the platform commission percentage from settings.
 * Provider receives (100 - commission)% of the booking amount.
 */
async function getPlatformCommission(): Promise<number> {
  const { rows } = await db.query<{ value: string }>(
    `SELECT value FROM platform_settings WHERE key = 'platform_commission_percent' LIMIT 1`,
  );
  return rows[0] ? parseFloat(rows[0].value) : 20; // default 20%
}

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Process a confirmed payment end-to-end.
 *
 * Called by webhook.controller.ts after payment_intent.succeeded.
 * Wraps everything in a DB transaction so partial failures roll back cleanly.
 */
export async function processConfirmedPayment(
  paymentIntentId: string,
): Promise<BookingPaymentResult> {
  const payment = await findPaymentByIntentId(paymentIntentId);
  if (!payment) {
    throw Object.assign(new Error('Payment record not found'), {
      code: 'NOT_FOUND',
      statusCode: 404,
    });
  }

  // Idempotency guard — don't re-process if already handled.
  if (payment.status === 'succeeded') {
    const booking = await getBookingWithDetails(payment.booking_id);
    if (booking?.payment_status === 'paid') {
      logger.info('Payment already processed, skipping', {
        paymentIntentId,
        bookingId: payment.booking_id,
      });
      return {
        bookingId: payment.booking_id,
        paymentId: payment.id,
        status: 'already_processed',
      };
    }
  }

  // Server-side verification against Stripe (don't trust the webhook payload alone).
  let intent: Stripe.PaymentIntent;
  try {
    intent = await retrievePaymentIntent(paymentIntentId);
  } catch (err) {
    logger.error('Failed to retrieve PaymentIntent from Stripe', { paymentIntentId, err });
    throw err;
  }

  if (intent.status !== 'succeeded') {
    logger.warn('PaymentIntent not succeeded on Stripe side', {
      paymentIntentId,
      stripeStatus: intent.status,
    });
    return {
      bookingId: payment.booking_id,
      paymentId: payment.id,
      status: 'already_processed',
    };
  }

  const booking = await getBookingWithDetails(payment.booking_id);
  if (!booking) {
    throw Object.assign(new Error('Booking not found'), {
      code: 'NOT_FOUND',
      statusCode: 404,
    });
  }

  const commissionPercent = await getPlatformCommission();
  const providerEarnings = Math.floor(
    (booking.total_amount * (100 - commissionPercent)) / 100,
  );

  // ── Atomic DB transaction ──────────────────────────────────────────────────
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Mark booking as paid and confirmed.
    await client.query(
      `UPDATE bookings
       SET payment_status = 'paid',
           status         = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
           updated_at     = now()
       WHERE id = $1`,
      [booking.id],
    );

    // 2. Update payment row to succeeded (in case webhook handler ran first,
    //    this is idempotent).
    await client.query(
      `UPDATE payments
       SET status     = 'succeeded',
           paid_at    = COALESCE(paid_at, now()),
           updated_at = now()
       WHERE stripe_payment_intent_id = $1`,
      [paymentIntentId],
    );

    // 3. Credit provider's wallet with their earnings (minus platform commission).
    await client.query(
      `INSERT INTO wallet_transactions
         (wallet_id, amount, transaction_type, reference_id, description, status)
       SELECT w.id, $1, 'earning', $2, $3, 'completed'
       FROM wallets w
       WHERE w.user_id = $4`,
      [
        providerEarnings,
        booking.id,
        `Earnings for booking ${booking.id}`,
        booking.provider_user_id,
      ],
    );

    // Update provider wallet balance.
    await client.query(
      `UPDATE wallets
       SET balance    = balance + $1,
           updated_at = now()
       WHERE user_id  = $2`,
      [providerEarnings, booking.provider_user_id],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('DB transaction failed during processConfirmedPayment', {
      bookingId: booking.id,
      paymentIntentId,
      err,
    });
    throw err;
  } finally {
    client.release();
  }

  // ── Post-transaction side effects ──────────────────────────────────────────
  // These run after the transaction commits. Failures here are logged but
  // don't roll back the payment confirmation.

  // 4. Credit cashback to user wallet (async, non-blocking).
  let cashbackResult;
  try {
    cashbackResult = await creditCashback(
      booking.user_id,
      booking.id,
      booking.total_amount,
    );
  } catch (err) {
    logger.error('Cashback credit failed (non-fatal)', { bookingId: booking.id, err });
  }

  // 5. Queue push notifications (FCM) via BullMQ.
  try {
    await paymentConfirmedQueue.add('payment-confirmed', {
      userId: booking.user_id,
      providerUserId: booking.provider_user_id,
      bookingId: booking.id,
      amount: booking.total_amount,
    });
  } catch (err) {
    logger.error('Failed to queue payment notification (non-fatal)', { err });
  }

  logger.info('Payment confirmed and processed', {
    bookingId: booking.id,
    paymentIntentId,
    providerEarnings,
  });

  return {
    bookingId: booking.id,
    paymentId: payment.id,
    status: 'confirmed',
    cashback: cashbackResult,
  };
}

/**
 * Handle a payment failure — update booking and payment row.
 * Called by webhook.controller.ts on payment_intent.payment_failed.
 */
export async function processFailedPayment(
  paymentIntentId: string,
  failureCode?: string,
  failureMessage?: string,
): Promise<void> {
  const payment = await findPaymentByIntentId(paymentIntentId);
  if (!payment) return;

  await updatePaymentByIntentId(paymentIntentId, {
    status: 'failed',
    failure_code: failureCode,
    failure_message: failureMessage,
  });

  // Leave booking status as-is (pending) — user can retry payment.
  logger.warn('Payment failed', {
    paymentIntentId,
    bookingId: payment.booking_id,
    failureCode,
  });
}

/**
 * Process a cancellation refund for a booking.
 * Called by cancellation.service.ts when a booking is cancelled.
 */
export async function processRefundForCancellation(
  bookingId: string,
  refundAmount: number,   // in paise; pass full booking amount for full refund
): Promise<void> {
  const { rows } = await db.query(
    `SELECT stripe_payment_intent_id, user_id
     FROM payments
     WHERE booking_id = $1 AND status = 'succeeded'
     LIMIT 1`,
    [bookingId],
  );

  const payment = rows[0];
  if (!payment?.stripe_payment_intent_id) {
    logger.warn('No succeeded payment found for cancellation refund', { bookingId });
    return;
  }

  // Import here to avoid circular dependency with stripe.service.ts.
  const { issueRefund } = await import('./stripe.service');
  await issueRefund({
    paymentIntentId: payment.stripe_payment_intent_id,
    amount: refundAmount,
    reason: 'requested_by_customer',
  });

  logger.info('Refund issued for cancellation', { bookingId, refundAmount });
}
