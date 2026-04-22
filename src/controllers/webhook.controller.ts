// DEV 1 — Stripe webhook: payment_intent.succeeded/failed, charge.refunded

import { Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { PaymentModel } from '../models/payment.model';
import { WalletModel } from '../models/wallet.model';
import { WalletTransactionModel } from '../models/wallet-transaction.model';
import { StripeService } from '../services/stripe.service';
import { CashbackService } from '../services/cashback.service';
import { stripe } from '../config/stripe';
import { db } from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const paymentModel = new PaymentModel(db);
const walletModel = new WalletModel(db);
const txModel = new WalletTransactionModel(db);
const stripeService = new StripeService(stripe);
const cashbackService = new CashbackService(db);

/**
 * POST /api/payments/webhook
 *
 * Stripe sends signed events here. We use the raw body (parsed by
 * stripeWebhook middleware) to verify the signature before processing.
 *
 * Events handled:
 *   - payment_intent.succeeded   → mark payment succeeded, deduct wallet if mixed, credit cashback
 *   - payment_intent.payment_failed → mark payment failed
 *   - charge.refunded            → mark payment refunded / partially_refunded
 */
export async function handleStripeWebhook(req: Request, res: Response, next: NextFunction) {
  let event: Stripe.Event;

  try {
    const sig = req.headers['stripe-signature'] as string;
    event = stripeService.constructWebhookEvent(
      req.body as Buffer,   // raw body — set by stripeWebhook middleware
      sig,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Signature verification failed';
    logger.warn('Stripe webhook signature failed', { error: message });
    return res.status(400).json({ error: message });
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await onPaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      case 'payment_intent.payment_failed':
        await onPaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        break;

      case 'charge.refunded':
        await onChargeRefunded(event.data.object as Stripe.Charge);
        break;

      default:
        // Silently acknowledge unhandled events — avoids Stripe retry storms
        logger.debug('Unhandled Stripe event', { type: event.type });
    }

    return res.json({ received: true });
  } catch (err) {
    logger.error('Error processing Stripe webhook', { event: event.type, err });
    // Return 200 so Stripe doesn't retry — errors are logged and alerted separately
    return res.json({ received: true, warning: 'Processing error logged' });
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function onPaymentIntentSucceeded(intent: Stripe.PaymentIntent) {
  const payment = await paymentModel.findByStripeIntentId(intent.id);
  if (!payment) {
    logger.warn('Payment record not found for intent', { intentId: intent.id });
    return;
  }

  if (payment.status === 'succeeded') {
    logger.info('Duplicate succeeded event, skipping', { intentId: intent.id });
    return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // If mixed payment, deduct the wallet portion now
    if (payment.wallet_amount > 0 && payment.payment_method === 'mixed') {
      const wallet = await walletModel.findOrCreate(payment.user_id);
      const updatedWallet = await walletModel.debit(payment.user_id, payment.wallet_amount, client);

      await txModel.create(
        {
          walletId: wallet.id,
          userId: payment.user_id,
          type: 'debit',
          amount: payment.wallet_amount,
          balanceAfter: updatedWallet.balance,
          reason: 'payment',
          bookingId: payment.booking_id,
          referenceId: intent.id,
          description: `Wallet portion for booking #${payment.booking_id}`,
        },
        client
      );
    }

    // Mark payment succeeded
    const chargeId =
      typeof intent.latest_charge === 'string'
        ? intent.latest_charge
        : intent.latest_charge?.id ?? null;

    await paymentModel.updateStatus(payment.id, 'succeeded', {
      stripeChargeId: chargeId ?? undefined,
    });

    // Update booking status to payment_confirmed
    await client.query(
      `UPDATE bookings SET payment_status = 'paid', updated_at = NOW() WHERE id = $1`,
      [payment.booking_id]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Credit cashback asynchronously (outside the main tx, failure is non-critical)
  try {
    await cashbackService.creditCashback(
      payment.booking_id,
      payment.user_id,
      payment.amount,
      intent.id
    );
  } catch (err) {
    logger.error('Cashback credit failed', { bookingId: payment.booking_id, err });
  }

  logger.info('Payment succeeded', {
    paymentId: payment.id,
    bookingId: payment.booking_id,
    amount: payment.amount,
  });
}

async function onPaymentIntentFailed(intent: Stripe.PaymentIntent) {
  const payment = await paymentModel.findByStripeIntentId(intent.id);
  if (!payment) return;

  await paymentModel.updateStatus(payment.id, 'failed');

  logger.warn('Payment failed', {
    paymentId: payment.id,
    bookingId: payment.booking_id,
    reason: intent.last_payment_error?.message,
  });
}

async function onChargeRefunded(charge: Stripe.Charge) {
  const intentId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id ?? null;

  if (!intentId) return;

  const payment = await paymentModel.findByStripeIntentId(intentId);
  if (!payment) return;

  const refundedPaise = charge.amount_refunded;
  const newStatus = refundedPaise >= charge.amount ? 'refunded' : 'partially_refunded';

  await paymentModel.updateByIntentId(intentId, newStatus, {
    refundAmount: refundedPaise,
  });

  logger.info('Charge refunded', {
    paymentId: payment.id,
    refundedPaise,
    status: newStatus,
  });
}
