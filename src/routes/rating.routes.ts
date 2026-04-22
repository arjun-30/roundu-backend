// EXISTING
// src/routes/rating.routes.ts
// Manages user ratings for completed bookings.
//
// Endpoints:
//   POST /api/ratings                  — submit a rating (bearer)
//   GET  /api/ratings/provider/:id     — get provider ratings + stats (public)
//
// Business rules enforced here:
//   - A user can only rate a booking they own.
//   - The booking must be in 'completed' status.
//   - One rating per booking (model UNIQUE constraint; returns 409 here).
//   - Rating value must be 1–5 integer.
//
// API Contract ref: §9 Ratings

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  createRating,
  findRatingByBookingId,
  findRatingsByProviderId,
} from '../models/rating.model';
import { db } from '../config/database';
import { sendSuccess, sendError } from '../utils/response';
import { logger } from '../utils/logger';

const router = Router();

// ─── Validation Schemas ───────────────────────────────────────────────────────

const createRatingSchema = z.object({
  body: z.object({
    bookingId: z
      .string({ required_error: 'bookingId is required' })
      .uuid('bookingId must be a valid UUID'),

    rating: z
      .number({ required_error: 'rating is required' })
      .int('rating must be an integer')
      .min(1, 'rating must be at least 1')
      .max(5, 'rating must be at most 5'),

    review: z
      .string()
      .max(1000, 'review must be 1000 characters or less')
      .optional(),

    tags: z
      .array(z.string().max(50))
      .max(10, 'maximum 10 tags allowed')
      .optional(),

    isAnonymous: z
      .boolean()
      .optional()
      .default(false),
  }),
});

const providerRatingsQuerySchema = z.object({
  query: z.object({
    page: z
      .string().optional()
      .transform((v) => (v ? parseInt(v, 10) : 1))
      .pipe(z.number().min(1)),
    limit: z
      .string().optional()
      .transform((v) => (v ? parseInt(v, 10) : 10))
      .pipe(z.number().min(1).max(50)),
  }),
});

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * POST /api/ratings
 *
 * Submit a rating for a completed booking.
 * Auth: bearer
 *
 * Guards (checked in order):
 *   1. Booking exists and belongs to the requesting user.
 *   2. Booking status is 'completed'.
 *   3. No rating already exists for this booking (→ 409).
 */
async function submitRating(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user!.id;
    const { bookingId, rating, review, tags, isAnonymous } = req.body as {
      bookingId: string;
      rating: number;
      review?: string;
      tags?: string[];
      isAnonymous: boolean;
    };

    // Guard 1: fetch booking and verify ownership.
    const { rows: bookingRows } = await db.query(
      `SELECT id, user_id, provider_id, service_id, status
       FROM bookings WHERE id = $1`,
      [bookingId],
    );

    const booking = bookingRows[0];
    if (!booking) {
      sendError(res, 404, 'NOT_FOUND', 'Booking not found');
      return;
    }

    if (booking.user_id !== userId) {
      sendError(res, 403, 'FORBIDDEN', 'You can only rate your own bookings');
      return;
    }

    // Guard 2: booking must be completed.
    if (booking.status !== 'completed') {
      sendError(
        res, 422, 'UNPROCESSABLE',
        `Cannot rate a booking with status '${booking.status}'. ` +
        'Booking must be completed first.',
      );
      return;
    }

    // Guard 3: one rating per booking.
    const existing = await findRatingByBookingId(bookingId);
    if (existing) {
      sendError(res, 409, 'CONFLICT', 'You have already rated this booking');
      return;
    }

    const newRating = await createRating({
      booking_id: bookingId,
      user_id: userId,
      provider_id: booking.provider_id,
      service_id: booking.service_id,
      rating,
      review,
      tags,
      is_anonymous: isAnonymous,
    });

    logger.info('Rating submitted', {
      ratingId: newRating.id,
      bookingId,
      userId,
      rating,
    });

    sendSuccess(res, 201, newRating, undefined, 'Rating submitted successfully');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/ratings/provider/:id
 *
 * Get paginated ratings for a provider, with aggregate stats.
 * Auth: public — visible to anyone browsing the provider's profile.
 *
 * Response includes:
 *   - Paginated rating rows (with reviewer name, service name)
 *   - Average rating
 *   - Star distribution (1★ → 5★ counts)
 */
async function getProviderRatings(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const providerId = req.params.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    // Verify the provider exists before querying ratings.
    const { rows } = await db.query(
      'SELECT id FROM providers WHERE id = $1',
      [providerId],
    );
    if (!rows[0]) {
      sendError(res, 404, 'NOT_FOUND', 'Provider not found');
      return;
    }

    const result = await findRatingsByProviderId(providerId, page, limit);

    sendSuccess(
      res,
      200,
      result.data,
      {
        total: result.total,
        page,
        limit,
        averageRating: result.averageRating,
        distribution: result.distribution,
      },
    );
  } catch (err) {
    next(err);
  }
}

// ─── Route Registration ───────────────────────────────────────────────────────

/**
 * POST /api/ratings
 * Submit a rating for a completed booking.
 * Requires bearer auth — only the booking's owner can rate.
 */
router.post(
  '/',
  auth,
  validate(createRatingSchema),
  submitRating,
);

/**
 * GET /api/ratings/provider/:id
 * Public — no auth required.
 * Returns paginated ratings + aggregate stats for the given provider.
 */
router.get(
  '/provider/:id',
  validate(providerRatingsQuerySchema),
  getProviderRatings,
);

export default router;
