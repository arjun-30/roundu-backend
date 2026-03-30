// DEV 1 — create, findByUserId, credit, debit, getBalance, findOrCreate

import { Pool, PoolClient } from 'pg';

export interface Wallet {
  id: string;
  user_id: string;
  balance: number; // stored in paise
  currency: string;
  created_at: Date;
  updated_at: Date;
}

export class WalletModel {
  constructor(private db: Pool) {}

  async findByUserId(userId: string): Promise<Wallet | null> {
    const result = await this.db.query<Wallet>(
      `SELECT * FROM wallets WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] ?? null;
  }

  async findById(id: string): Promise<Wallet | null> {
    const result = await this.db.query<Wallet>(
      `SELECT * FROM wallets WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async create(userId: string, currency = 'INR'): Promise<Wallet> {
    const result = await this.db.query<Wallet>(
      `INSERT INTO wallets (user_id, balance, currency)
       VALUES ($1, 0, $2)
       RETURNING *`,
      [userId, currency]
    );
    return result.rows[0];
  }

  /**
   * Gets existing wallet or creates one if it doesn't exist.
   * Safe to call on every request.
   */
  async findOrCreate(userId: string): Promise<Wallet> {
    const result = await this.db.query<Wallet>(
      `INSERT INTO wallets (user_id, balance, currency)
       VALUES ($1, 0, 'INR')
       ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [userId]
    );
    return result.rows[0];
  }

  /**
   * Credits balance atomically. Must be called inside a transaction for
   * consistency with wallet_transactions insert.
   */
  async credit(
    userId: string,
    amountPaise: number,
    client?: PoolClient
  ): Promise<Wallet> {
    const conn = client ?? this.db;
    const result = await conn.query<Wallet>(
      `UPDATE wallets
       SET balance = balance + $2, updated_at = NOW()
       WHERE user_id = $1
       RETURNING *`,
      [userId, amountPaise]
    );
    if (!result.rows[0]) throw new Error(`Wallet not found for user ${userId}`);
    return result.rows[0];
  }

  /**
   * Debits balance atomically. Throws if insufficient balance.
   */
  async debit(
    userId: string,
    amountPaise: number,
    client?: PoolClient
  ): Promise<Wallet> {
    const conn = client ?? this.db;
    const result = await conn.query<Wallet>(
      `UPDATE wallets
       SET balance = balance - $2, updated_at = NOW()
       WHERE user_id = $1 AND balance >= $2
       RETURNING *`,
      [userId, amountPaise]
    );
    if (!result.rows[0]) {
      throw new Error('Insufficient wallet balance');
    }
    return result.rows[0];
  }

  async getBalance(userId: string): Promise<number> {
    const result = await this.db.query<{ balance: number }>(
      `SELECT balance FROM wallets WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0]?.balance ?? 0;
  }
}
