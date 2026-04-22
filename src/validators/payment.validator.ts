// DEV 1 — Zod validators for payment endpoints

import { z } from 'zod';

export const createPaymentIntentSchema = z.object({
  bookingId: z
    .string({ required_error: 'bookingId is required' })
    .uuid('Invalid booking ID'),
  useWalletBalance: z.boolean().default(false),
});

export const paymentHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreatePaymentIntentBody = z.infer<typeof createPaymentIntentSchema>;
export type PaymentHistoryQuery = z.infer<typeof paymentHistoryQuerySchema>;
