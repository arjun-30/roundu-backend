// DEV 1 — getWallet, topUp, getHistory, payFromWallet

import { Request, Response, NextFunction } from 'express';
import { WalletModel } from '../models/wallet.model';
import { WalletTransactionModel } from '../models/wallet-transaction.model';
import { getTransactionsQuerySchema, withdrawSchema } from '../validators/wallet.validator';
import { db } from '../config/database';         // pg Pool singleton
import { success, paginated } from '../utils/response';
import { AppError } from '../middleware/errorHandler';

const walletModel = new WalletModel(db);
const txModel = new WalletTransactionModel(db);

/**
 * GET /api/wallet
 * Returns the authenticated user's wallet balance.
 */
export async function getWallet(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const wallet = await walletModel.findOrCreate(userId);

    return res.json(
      success({
        balance: wallet.balance,          // paise
        balanceFormatted: wallet.balance / 100, // rupees (for display)
        currency: wallet.currency,
      })
    );
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/wallet/transactions
 * Paginated transaction history with optional type filter.
 */
export async function getTransactions(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const query = getTransactionsQuerySchema.parse(req.query);

    const wallet = await walletModel.findOrCreate(userId);
    const result = await txModel.findByWalletId(wallet.id, {
      type: query.type,
      page: query.page,
      limit: query.limit,
    });

    return res.json(
      paginated(result.data, result.total, result.page, result.limit)
    );
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/wallet/withdraw
 * Provider-only: queues a withdrawal to a linked bank account.
 *
 * The actual bank transfer is handled async via a BullMQ job.
 * Here we just validate balance and create the debit transaction + job.
 */
export async function withdraw(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const body = withdrawSchema.parse(req.body);

    const wallet = await walletModel.findOrCreate(userId);

    if (wallet.balance < body.amount) {
      throw new AppError('Insufficient wallet balance', 400, 'INSUFFICIENT_BALANCE');
    }

    // Debit wallet and record transaction atomically
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const updatedWallet = await walletModel.debit(userId, body.amount, client);

      await txModel.create(
        {
          walletId: wallet.id,
          userId,
          type: 'debit',
          amount: body.amount,
          balanceAfter: updatedWallet.balance,
          reason: 'withdrawal',
          bookingId: null,
          referenceId: body.bankAccountId,
          description: `Withdrawal to bank account ${body.bankAccountId}`,
        },
        client
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // TODO: enqueue withdrawal job → bank transfer via payment gateway
    // await withdrawalQueue.add('process-withdrawal', { userId, amount: body.amount, bankAccountId: body.bankAccountId });

    return res.json(
      success({ message: 'Withdrawal queued successfully', amountPaise: body.amount })
    );
  } catch (err) {
    next(err);
  }
}
