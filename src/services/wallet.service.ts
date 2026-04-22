// src/services/wallet.service.ts
// Owner: Dev 3 — Wallet Service
//
// Public API consumed by:
//   - cashback.service.ts  → creditWallet({ type: 'cashback' })
//   - payment.service.ts   → creditWallet({ type: 'earning' }) for providers
//   - wallet.controller.ts → getBalance, getTransactions, topUp, payWithWallet, requestWithdrawal

import {
  getOrCreateWallet,
  findWalletByUserId,
  atomicCredit,
  atomicDebit,
  findTransactionsByUserId,
  Wallet,
  WalletTransaction,
  TransactionType,
} from '../models/wallet.model';
import { db } from '../config/database';
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreditInput {
  userId: string;
  amount: number;             // paise, must be > 0
  type: TransactionType;
  referenceId?: string;
  description?: string;
}

export interface DebitInput {
  userId: string;
  amount: number;             // paise, must be > 0
  type: TransactionType;
  referenceId?: string;
  description?: string;
}

export interface TopUpInput {
  userId: string;
  amount: number;             // paise
  stripePaymentIntentId?: string;  // if topped up via Stripe
}

export interface WithdrawalInput {
  userId: string;
  amount: number;             // paise
  bankAccountId: string;
}

// ─── Core Operations ──────────────────────────────────────────────────────────

/**
 * Get wallet balance for a user.
 * Auto-creates wallet on first call.
 */
export async function getWalletBalance(userId: string): Promise<Wallet> {
  return getOrCreateWallet(userId);
}

/**
 * Credit an amount to a user's wallet.
 * Used for cashback, refunds, earnings, referral rewards, top-ups.
 */
export async function creditWallet(input: CreditInput): Promise<WalletTransaction> {
  if (input.amount <= 0) {
    throw Object.assign(new Error('Credit amount must be positive'), {
      code: 'VALIDATION_ERROR', statusCode: 400,
    });
  }

  const tx = await atomicCredit(
    input.userId,
    input.amount,
    input.type,
    input.referenceId,
    input.description,
  );

  logger.info('Wallet credited', {
    userId: input.userId,
    amount: input.amount,
    type: input.type,
    txId: tx.id,
  });

  return tx;
}

/**
 * Debit an amount from a user's wallet.
 * Used for booking payments and withdrawal disbursements.
 * Throws INSUFFICIENT_BALANCE if funds are too low.
 */
export async function debitWallet(input: DebitInput): Promise<WalletTransaction> {
  if (input.amount <= 0) {
    throw Object.assign(new Error('Debit amount must be positive'), {
      code: 'VALIDATION_ERROR', statusCode: 400,
    });
  }

  const tx = await atomicDebit(
    input.userId,
    input.amount,
    input.type,
    input.referenceId,
    input.description,
  );

  logger.info('Wallet debited', {
    userId: input.userId,
    amount: input.amount,
    type: input.type,
    txId: tx.id,
  });

  return tx;
}

/**
 * Top up a wallet.
 * The Stripe charge itself is handled by stripe.service.ts — this function
 * is called AFTER payment is confirmed to credit the wallet balance.
 */
export async function topUpWallet(input: TopUpInput): Promise<WalletTransaction> {
  return creditWallet({
    userId: input.userId,
    amount: input.amount,
    type: 'topup',
    referenceId: input.stripePaymentIntentId,
    description: `Wallet top-up${input.stripePaymentIntentId ? ` via ${input.stripePaymentIntentId}` : ''}`,
  });
}

/**
 * Pay for a booking using wallet balance.
 * Used when the user selects "Pay with Wallet" at checkout.
 * Returns the debit transaction. Caller should also update booking.payment_status.
 */
export async function payBookingWithWallet(
  userId: string,
  bookingId: string,
  amount: number,
): Promise<WalletTransaction> {
  return debitWallet({
    userId,
    amount,
    type: 'booking_payment',
    referenceId: bookingId,
    description: `Payment for booking ${bookingId}`,
  });
}

/**
 * Request a withdrawal (provider only).
 * Creates a pending wallet_transaction row — actual bank transfer is
 * handled asynchronously by a payout job (out of Dev 3 scope).
 */
export async function requestWithdrawal(input: WithdrawalInput): Promise<WalletTransaction> {
  const { userId, amount, bankAccountId } = input;

  if (amount <= 0) {
    throw Object.assign(new Error('Withdrawal amount must be positive'), {
      code: 'VALIDATION_ERROR', statusCode: 400,
    });
  }

  // Minimum withdrawal: ₹100 (10000 paise)
  const MIN_WITHDRAWAL = 10_000;
  if (amount < MIN_WITHDRAWAL) {
    throw Object.assign(
      new Error(`Minimum withdrawal is ₹${MIN_WITHDRAWAL / 100}`),
      { code: 'VALIDATION_ERROR', statusCode: 400 },
    );
  }

  const wallet = await findWalletByUserId(userId);
  if (!wallet || wallet.balance < amount) {
    throw Object.assign(
      new Error('Insufficient wallet balance'),
      { code: 'INSUFFICIENT_BALANCE', statusCode: 400 },
    );
  }

  // Debit immediately (hold the funds); the payout job will transfer to bank.
  // If the bank transfer fails, a compensating credit is issued by the job.
  const tx = await atomicDebit(
    userId,
    amount,
    'withdrawal',
    bankAccountId,
    `Withdrawal to bank account ${bankAccountId}`,
  );

  // Store the pending withdrawal request for the payout job.
  await db.query(
    `INSERT INTO withdrawal_requests
       (user_id, wallet_transaction_id, amount, bank_account_id, status)
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT DO NOTHING`,
    [userId, tx.id, amount, bankAccountId],
  );

  logger.info('Withdrawal requested', { userId, amount, bankAccountId, txId: tx.id });

  return tx;
}

/**
 * Paginated transaction history for a user.
 */
export async function getTransactionHistory(
  userId: string,
  type?: 'credit' | 'debit',
  page: number = 1,
  limit: number = 10,
) {
  return findTransactionsByUserId(userId, type, page, limit);
}
