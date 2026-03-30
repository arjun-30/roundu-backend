// DEV 1 — Zod validators for wallet endpoints

import { z } from 'zod';

export const getTransactionsQuerySchema = z.object({
  type: z.enum(['credit', 'debit']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const withdrawSchema = z.object({
  amount: z
    .number({ required_error: 'Amount is required' })
    .positive('Amount must be positive')
    .int('Amount must be in paise (integer)'),
  bankAccountId: z
    .string({ required_error: 'Bank account ID is required' })
    .uuid('Invalid bank account ID'),
});

export type GetTransactionsQuery = z.infer<typeof getTransactionsQuerySchema>;
export type WithdrawBody = z.infer<typeof withdrawSchema>;
