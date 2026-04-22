// EXISTING
import { z } from 'zod';

export const approveProviderSchema = z.object({
  approved: z.boolean(),
  reason: z.string().max(500).optional(),
});

export const reviewDocumentSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  notes: z.string().max(500).optional(),
});

export const updateSettingSchema = z.object({
  value: z.string().min(1, 'Value is required'),
});

export const banUserSchema = z.object({
  banned: z.boolean(),
  reason: z.string().max(500).optional(),
});

export const revenueReportSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD'),
});

export const listQuerySchema = z.object({
  page: z.string().default('1').transform(Number),
  limit: z.string().default('20').transform(Number),
  search: z.string().optional(),
  role: z.string().optional(),
  status: z.string().optional(),
});
