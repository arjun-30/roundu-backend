// DEV 1 — create, findByWalletId(paginated), findByBookingId

import { Pool, PoolClient } from 'pg';

export type TransactionType = 'credit' | 'debit';
export type TransactionReason =
  | 'cashback'
  | 'refund'
  | 'topup'
  | 'payment'
  | 'withdrawal'
  | 'referral_reward'
  | 'adjustment';

export interface WalletTransaction {
  id: string;
  wallet_id: string;
  user_id: string;
  type: TransactionType;
  amount: number; // in paise
  balance_after: number; // in paise
  reason: TransactionReason;
  booking_id: string | null;
  reference_id: string | null; // stripe payment intent ID, etc.
  description: string;
  created_at: Date;
}

export interface PaginatedTransactions {
  data: WalletTransaction[];
  total: number;
  page: number;
  limit: number;
}

export class WalletTransactionModel {
  constructor(private db: Pool) {}

  async create(
    params: {
      walletId: string;
      userId: string;
      type: TransactionType;
      amount: number;
      balanceAfter: number;
      reason: TransactionReason;
      bookingId?: string | null;
      referenceId?: string | null;
      description: string;
    },
    client?: PoolClient
  ): Promise<WalletTransaction> {
    const conn = client ?? this.db;
    const result = await conn.query<WalletTransaction>(
      `INSERT INTO wallet_transactions
         (wallet_id, user_id, type, amount, balance_after, reason, booking_id, reference_id, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        params.walletId,
        params.userId,
        params.type,
        params.amount,
        params.balanceAfter,
        params.reason,
        params.bookingId ?? null,
        params.referenceId ?? null,
        params.description,
      ]
    );
    return result.rows[0];
  }

  async findByWalletId(
    walletId: string,
    options: {
      type?: TransactionType;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<PaginatedTransactions> {
    const page = options.page ?? 1;
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = (page - 1) * limit;

    const conditions: string[] = ['wallet_id = $1'];
    const values: unknown[] = [walletId];
    let paramIdx = 2;

    if (options.type) {
      conditions.push(`type = $${paramIdx++}`);
      values.push(options.type);
    }

    const where = conditions.join(' AND ');

    const [dataResult, countResult] = await Promise.all([
      this.db.query<WalletTransaction>(
        `SELECT * FROM wallet_transactions
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...values, limit, offset]
      ),
      this.db.query<{ count: string }>(
        `SELECT COUNT(*) FROM wallet_transactions WHERE ${where}`,
        values
      ),
    ]);

    return {
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit,
    };
  }

  async findByBookingId(bookingId: string): Promise<WalletTransaction[]> {
    const result = await this.db.query<WalletTransaction>(
      `SELECT * FROM wallet_transactions
       WHERE booking_id = $1
       ORDER BY created_at ASC`,
      [bookingId]
    );
    return result.rows;
  }
}
