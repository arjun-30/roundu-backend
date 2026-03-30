// DEV 1 — CHANGED: stripe_payment_intent_id replaces razorpay fields

import { Pool } from 'pg';

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded';
export type PaymentMethod = 'stripe' | 'wallet' | 'mixed'; // mixed = partial wallet + stripe

export interface Payment {
  id: string;
  booking_id: string;
  user_id: string;
  amount: number;                       // total amount in paise
  wallet_amount: number;                // portion paid from wallet (paise)
  stripe_amount: number;                // portion charged via Stripe (paise)
  currency: string;
  status: PaymentStatus;
  payment_method: PaymentMethod;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  refund_amount: number;                // total refunded so far (paise)
  stripe_refund_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export class PaymentModel {
  constructor(private db: Pool) {}

  async create(params: {
    bookingId: string;
    userId: string;
    amount: number;
    walletAmount?: number;
    stripeAmount?: number;
    currency?: string;
    paymentMethod: PaymentMethod;
    stripePaymentIntentId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<Payment> {
    const result = await this.db.query<Payment>(
      `INSERT INTO payments
         (booking_id, user_id, amount, wallet_amount, stripe_amount,
          currency, status, payment_method, stripe_payment_intent_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9)
       RETURNING *`,
      [
        params.bookingId,
        params.userId,
        params.amount,
        params.walletAmount ?? 0,
        params.stripeAmount ?? params.amount,
        params.currency ?? 'INR',
        params.paymentMethod,
        params.stripePaymentIntentId ?? null,
        JSON.stringify(params.metadata ?? {}),
      ]
    );
    return result.rows[0];
  }

  async findById(id: string): Promise<Payment | null> {
    const result = await this.db.query<Payment>(
      `SELECT * FROM payments WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async findByBookingId(bookingId: string): Promise<Payment | null> {
    const result = await this.db.query<Payment>(
      `SELECT * FROM payments WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [bookingId]
    );
    return result.rows[0] ?? null;
  }

  async findByStripeIntentId(intentId: string): Promise<Payment | null> {
    const result = await this.db.query<Payment>(
      `SELECT * FROM payments WHERE stripe_payment_intent_id = $1`,
      [intentId]
    );
    return result.rows[0] ?? null;
  }

  async findByUserId(
    userId: string,
    page = 1,
    limit = 20
  ): Promise<{ data: Payment[]; total: number; page: number; limit: number }> {
    const offset = (page - 1) * limit;
    const [dataResult, countResult] = await Promise.all([
      this.db.query<Payment>(
        `SELECT * FROM payments WHERE user_id = $1
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      ),
      this.db.query<{ count: string }>(
        `SELECT COUNT(*) FROM payments WHERE user_id = $1`,
        [userId]
      ),
    ]);
    return {
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit,
    };
  }

  async updateStatus(
    id: string,
    status: PaymentStatus,
    extra: {
      stripeChargeId?: string;
      stripeRefundId?: string;
      refundAmount?: number;
    } = {}
  ): Promise<Payment> {
    const result = await this.db.query<Payment>(
      `UPDATE payments
       SET status = $2,
           stripe_charge_id   = COALESCE($3, stripe_charge_id),
           stripe_refund_id   = COALESCE($4, stripe_refund_id),
           refund_amount      = COALESCE($5, refund_amount),
           updated_at         = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        status,
        extra.stripeChargeId ?? null,
        extra.stripeRefundId ?? null,
        extra.refundAmount ?? null,
      ]
    );
    return result.rows[0];
  }

  async updateByIntentId(
    intentId: string,
    status: PaymentStatus,
    extra: {
      stripeChargeId?: string;
      stripeRefundId?: string;
      refundAmount?: number;
    } = {}
  ): Promise<Payment | null> {
    const result = await this.db.query<Payment>(
      `UPDATE payments
       SET status           = $2,
           stripe_charge_id = COALESCE($3, stripe_charge_id),
           stripe_refund_id = COALESCE($4, stripe_refund_id),
           refund_amount    = COALESCE($5, refund_amount),
           updated_at       = NOW()
       WHERE stripe_payment_intent_id = $1
       RETURNING *`,
      [
        intentId,
        status,
        extra.stripeChargeId ?? null,
        extra.stripeRefundId ?? null,
        extra.refundAmount ?? null,
      ]
    );
    return result.rows[0] ?? null;
  }
}
