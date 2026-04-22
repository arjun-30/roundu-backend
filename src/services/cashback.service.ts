// DEV 1 — creditCashback(bookingId, amount) 5% to wallet

import { Pool } from 'pg';
import { WalletModel } from '../models/wallet.model';
import { WalletTransactionModel } from '../models/wallet-transaction.model';

const CASHBACK_PERCENT = 5;

export class CashbackService {
  private walletModel: WalletModel;
  private txModel: WalletTransactionModel;

  constructor(private db: Pool) {
    this.walletModel = new WalletModel(db);
    this.txModel = new WalletTransactionModel(db);
  }

  /**
   * Credits 5% cashback of the paid amount to the customer's wallet.
   * Runs inside a DB transaction to ensure wallet + transaction log stay in sync.
   *
   * @param bookingId   - the completed booking
   * @param userId      - the customer who paid
   * @param paidPaise   - total amount paid in paise
   * @param referenceId - Stripe payment intent ID for traceability
   */
  async creditCashback(
    bookingId: string,
    userId: string,
    paidPaise: number,
    referenceId?: string
  ): Promise<{ cashbackPaise: number }> {
    const cashbackPaise = Math.floor((paidPaise * CASHBACK_PERCENT) / 100);

    if (cashbackPaise <= 0) {
      return { cashbackPaise: 0 };
    }

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      // Ensure wallet exists
      await this.walletModel.findOrCreate(userId);

      // Credit wallet
      const updatedWallet = await this.walletModel.credit(userId, cashbackPaise, client);

      // Record transaction
      await this.txModel.create(
        {
          walletId: updatedWallet.id,
          userId,
          type: 'credit',
          amount: cashbackPaise,
          balanceAfter: updatedWallet.balance,
          reason: 'cashback',
          bookingId,
          referenceId: referenceId ?? null,
          description: `${CASHBACK_PERCENT}% cashback for booking #${bookingId}`,
        },
        client
      );

      await client.query('COMMIT');
      return { cashbackPaise };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
