// DEV 1 — calculateRefund(booking, cancelledBy) IRCTC slab logic

import { Pool } from 'pg';
import { WalletModel } from '../models/wallet.model';
import { WalletTransactionModel } from '../models/wallet-transaction.model';
import { PaymentModel } from '../models/payment.model';
import { StripeService } from './stripe.service';
import { calculateRefund } from '../utils/cancellation-slabs';

export type CancelledBy = 'customer' | 'provider' | 'admin';

export interface CancellationResult {
  refundPercent: number;
  refundAmountPaise: number;
  walletRefundPaise: number;
  stripeRefundPaise: number;
  slabLabel: string;
  stripeRefundId: string | null;
}

export class CancellationService {
  private walletModel: WalletModel;
  private txModel: WalletTransactionModel;
  private paymentModel: PaymentModel;

  constructor(
    private db: Pool,
    private stripeService: StripeService
  ) {
    this.walletModel = new WalletModel(db);
    this.txModel = new WalletTransactionModel(db);
    this.paymentModel = new PaymentModel(db);
  }

  /**
   * Calculates and executes refund for a cancelled booking.
   * - Provider/admin cancellation → always 100% refund regardless of slab.
   * - Customer cancellation → IRCTC slab refund.
   * Refund goes back to original payment source (wallet → wallet, Stripe → Stripe).
   */
  async processRefund(
    bookingId: string,
    userId: string,
    scheduledAt: Date | string,
    cancelledBy: CancelledBy
  ): Promise<CancellationResult> {
    const payment = await this.paymentModel.findByBookingId(bookingId);
    if (!payment || payment.status === 'refunded') {
      return {
        refundPercent: 0,
        refundAmountPaise: 0,
        walletRefundPaise: 0,
        stripeRefundPaise: 0,
        slabLabel: 'No eligible payment found',
        stripeRefundId: null,
      };
    }

    // Provider or admin cancellation → full refund always
    const isForceFullRefund = cancelledBy !== 'customer';
    const slabResult = isForceFullRefund
      ? {
          refundPercent: 100,
          refundAmount: payment.amount,
          deductedAmount: 0,
          slabLabel: 'Full refund (cancelled by provider/admin)',
        }
      : calculateRefund(scheduledAt, payment.amount);

    const totalRefundPaise = slabResult.refundAmount;

    if (totalRefundPaise === 0) {
      return {
        refundPercent: 0,
        refundAmountPaise: 0,
        walletRefundPaise: 0,
        stripeRefundPaise: 0,
        slabLabel: slabResult.slabLabel,
        stripeRefundId: null,
      };
    }

    // Split refund proportionally across original payment sources
    const totalPaid = payment.amount;
    const walletShare = totalPaid > 0 ? payment.wallet_amount / totalPaid : 0;
    const walletRefundPaise = Math.floor(totalRefundPaise * walletShare);
    const stripeRefundPaise = totalRefundPaise - walletRefundPaise;

    let stripeRefundId: string | null = null;
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      // Refund wallet portion back to wallet
      if (walletRefundPaise > 0) {
        await this.walletModel.findOrCreate(userId);
        const updatedWallet = await this.walletModel.credit(userId, walletRefundPaise, client);
        await this.txModel.create(
          {
            walletId: updatedWallet.id,
            userId,
            type: 'credit',
            amount: walletRefundPaise,
            balanceAfter: updatedWallet.balance,
            reason: 'refund',
            bookingId,
            referenceId: payment.stripe_payment_intent_id,
            description: `Refund for cancelled booking #${bookingId} (${slabResult.slabLabel})`,
          },
          client
        );
      }

      // Refund Stripe portion via Stripe API
      if (stripeRefundPaise > 0 && payment.stripe_payment_intent_id) {
        const refund = await this.stripeService.createRefund({
          paymentIntentId: payment.stripe_payment_intent_id,
          amountPaise: stripeRefundPaise,
        });
        stripeRefundId = refund.id;
      }

      // Update payment record
      const newStatus =
        totalRefundPaise >= payment.amount ? 'refunded' : 'partially_refunded';
      await this.paymentModel.updateStatus(payment.id, newStatus, {
        stripeRefundId: stripeRefundId ?? undefined,
        refundAmount: totalRefundPaise,
      });

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return {
      refundPercent: slabResult.refundPercent,
      refundAmountPaise: totalRefundPaise,
      walletRefundPaise,
      stripeRefundPaise,
      slabLabel: slabResult.slabLabel,
      stripeRefundId,
    };
  }
}
