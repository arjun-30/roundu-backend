// DEV 1 — Stripe createIntent, confirm, refund, getByBookingId

import { Request, Response, NextFunction } from 'express';
import { PaymentModel } from '../models/payment.model';
import { WalletModel } from '../models/wallet.model';
import { WalletTransactionModel } from '../models/wallet-transaction.model';
import { StripeService } from '../services/stripe.service';
import { createPaymentIntentSchema, paymentHistoryQuerySchema } from '../validators/payment.validator';
import { db } from '../config/database';
import { stripe } from '../config/stripe';           // Stripe SDK singleton
import { success, paginated } from '../utils/response';
import { AppError } from '../middleware/errorHandler';

const paymentModel = new PaymentModel(db);
const walletModel = new WalletModel(db);
const txModel = new WalletTransactionModel(db);
const stripeService = new StripeService(stripe);

/**
 * POST /api/payments/intent
 * Creates a Stripe PaymentIntent for a booking.
 *
 * Supports partial wallet payment:
 *   - If useWalletBalance=true and user has balance, the wallet covers
 *     as much as possible; remaining goes to Stripe.
 *   - If wallet covers 100%, no Stripe intent is created.
 */
export async function createPaymentIntent(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const body = createPaymentIntentSchema.parse(req.body);

    // Verify booking exists and belongs to user
    const bookingResult = await db.query(
      `SELECT id, total_amount, status, user_id FROM bookings WHERE id = $1`,
      [body.bookingId]
    );
    const booking = bookingResult.rows[0];

    if (!booking) throw new AppError('Booking not found', 404, 'NOT_FOUND');
    if (booking.user_id !== userId) throw new AppError('Forbidden', 403, 'FORBIDDEN');
    if (booking.status === 'cancelled') {
      throw new AppError('Cannot pay for a cancelled booking', 400, 'BAD_REQUEST');
    }

    // Check if already paid
    const existingPayment = await paymentModel.findByBookingId(body.bookingId);
    if (existingPayment?.status === 'succeeded') {
      throw new AppError('Booking is already paid', 400, 'ALREADY_PAID');
    }

    const totalPaise: number = booking.total_amount; // stored in paise in DB

    // Determine wallet contribution
    let walletPaise = 0;
    if (body.useWalletBalance) {
      const walletBalance = await walletModel.getBalance(userId);
      walletPaise = Math.min(walletBalance, totalPaise);
    }

    const stripePaise = totalPaise - walletPaise;

    // If fully covered by wallet — no Stripe intent needed
    if (stripePaise === 0) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');

        const wallet = await walletModel.findOrCreate(userId);
        await walletModel.debit(userId, walletPaise, client);

        const payment = await paymentModel.create({
          bookingId: body.bookingId,
          userId,
          amount: totalPaise,
          walletAmount: walletPaise,
          stripeAmount: 0,
          paymentMethod: 'wallet',
        });

        await txModel.create(
          {
            walletId: wallet.id,
            userId,
            type: 'debit',
            amount: walletPaise,
            balanceAfter: wallet.balance - walletPaise,
            reason: 'payment',
            bookingId: body.bookingId,
            description: `Payment for booking #${body.bookingId}`,
          },
          client
        );

        await paymentModel.updateStatus(payment.id, 'succeeded');
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      return res.json(success({ fullyPaidFromWallet: true, clientSecret: null }));
    }

    // Create Stripe intent for remaining amount
    const intent = await stripeService.createPaymentIntent({
      amountPaise: stripePaise,
      bookingId: body.bookingId,
      userId,
      metadata: {
        wallet_amount: String(walletPaise),
        total_amount: String(totalPaise),
      },
    });

    // Create a pending payment record
    await paymentModel.create({
      bookingId: body.bookingId,
      userId,
      amount: totalPaise,
      walletAmount: walletPaise,
      stripeAmount: stripePaise,
      paymentMethod: walletPaise > 0 ? 'mixed' : 'stripe',
      stripePaymentIntentId: intent.id,
    });

    return res.json(
      success({
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
        stripeAmountPaise: stripePaise,
        walletAmountPaise: walletPaise,
      })
    );
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/payments/history
 * Paginated payment history for the current user.
 */
export async function getPaymentHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const query = paymentHistoryQuerySchema.parse(req.query);

    const result = await paymentModel.findByUserId(userId, query.page, query.limit);

    return res.json(paginated(result.data, result.total, result.page, result.limit));
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/payments/:bookingId
 * Get payment details for a specific booking.
 */
export async function getPaymentByBookingId(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { bookingId } = req.params;

    const payment = await paymentModel.findByBookingId(bookingId);
    if (!payment) throw new AppError('Payment not found', 404, 'NOT_FOUND');
    if (payment.user_id !== userId) throw new AppError('Forbidden', 403, 'FORBIDDEN');

    return res.json(success(payment));
  } catch (err) {
    next(err);
  }
}
