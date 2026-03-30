// src/validators/recommendation.validator.ts
// Owner: Dev 3 (GPS + AI)
// Zod schemas for all /api/recommendations endpoints.

import { z } from 'zod';

/**
 * GET /api/recommendations
 * Optional ?limit query param (1–20, default 10).
 */
export const getRecommendationsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 10 : parseInt(v, 10)))
    .pipe(
      z.number()
        .int('limit must be an integer')
        .min(1, 'limit must be at least 1')
        .max(20, 'limit cannot exceed 20'),
    ),
});

/**
 * POST /api/recommendations/feedback
 * Body: { recommendationId, action }
 */
export const recommendationFeedbackSchema = z.object({
  recommendationId: z
    .string({ required_error: 'recommendationId is required' })
    .uuid('recommendationId must be a valid UUID'),
  action: z.enum(['clicked', 'booked', 'dismissed'], {
    required_error: 'action is required',
    invalid_type_error: 'action must be one of: clicked, booked, dismissed',
  }),
});
