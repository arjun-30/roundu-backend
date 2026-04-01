// EXISTING — create, findByBookingId, findByProviderId
// src/models/rating.model.ts
// Stores user ratings for completed bookings.
// One rating per booking (enforced by UNIQUE constraint).
// After every insert, provider avg_rating is recalculated via
// provider.model.refreshProviderRating().
//
// Backs endpoints:
//   POST /api/ratings                  — submit rating (bearer)
//   GET  /api/ratings/provider/:id     — list ratings for a provider (public)

import { db } from '../config/database';
import { refreshProviderRating } from './provider.model';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Rating {
  id: string;
  booking_id: string;
  user_id: string;
  provider_id: string;
  service_id: string;
  rating: number;         // 1–5 integer
  review: string | null;  // text review
  tags: string[];         // e.g. ['punctual', 'professional', 'clean']
  is_anonymous: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Rating row joined with reviewer details — for display on provider profile. */
export interface RatingWithUser extends Rating {
  reviewer_name: string;
  reviewer_avatar: string | null;
  service_name: string;
}

export interface CreateRatingInput {
  booking_id: string;
  user_id: string;
  provider_id: string;
  service_id: string;
  rating: number;
  review?: string;
  tags?: string[];
  is_anonymous?: boolean;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Submit a rating for a completed booking.
 * POST /api/ratings
 *
 * Guards:
 *   - Booking must be completed (checked by controller before calling this).
 *   - One rating per booking (UNIQUE constraint on booking_id throws CONFLICT).
 *
 * After insert, recalculates the provider's avg_rating atomically.
 */
export async function createRating(
  input: CreateRatingInput,
): Promise<Rating> {
  const { rows } = await db.query<Rating>(
    `INSERT INTO ratings
       (booking_id, user_id, provider_id, service_id, rating, review, tags, is_anonymous)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.booking_id,
      input.user_id,
      input.provider_id,
      input.service_id,
      input.rating,
      input.review ?? null,
      input.tags ?? [],
      input.is_anonymous ?? false,
    ],
  );

  const rating = rows[0];

  // Recalculate provider's avg_rating in the background.
  // This is a fast UPDATE — acceptable to do inline.
  await refreshProviderRating(input.provider_id);

  return rating;
}

/**
 * Check whether a rating already exists for a booking.
 * Used by the controller to return 409 CONFLICT before attempting insert.
 */
export async function findRatingByBookingId(
  bookingId: string,
): Promise<Rating | null> {
  const { rows } = await db.query<Rating>(
    'SELECT * FROM ratings WHERE booking_id = $1',
    [bookingId],
  );
  return rows[0] ?? null;
}

/**
 * Paginated ratings for a provider's public profile.
 * GET /api/ratings/provider/:id (public)
 *
 * Returns ratings with reviewer name/avatar and aggregate stats.
 * Anonymous ratings show "Anonymous User" instead of the real name.
 */
export async function findRatingsByProviderId(
  providerId: string,
  page: number = 1,
  limit: number = 10,
): Promise<{
  data: RatingWithUser[];
  total: number;
  averageRating: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}> {
  const offset = (page - 1) * limit;

  const [dataResult, statsResult] = await Promise.all([
    db.query<RatingWithUser>(
      `SELECT
         r.*,
         CASE WHEN r.is_anonymous THEN 'Anonymous User' ELSE u.name END AS reviewer_name,
         CASE WHEN r.is_anonymous THEN NULL               ELSE u.avatar END AS reviewer_avatar,
         s.name AS service_name
       FROM ratings r
       JOIN users    u ON u.id = r.user_id
       JOIN services s ON s.id = r.service_id
       WHERE r.provider_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [providerId, limit, offset],
    ),
    db.query<{
      total: string;
      avg: string;
      r1: string; r2: string; r3: string; r4: string; r5: string;
    }>(
      `SELECT
         COUNT(*)                                   AS total,
         ROUND(AVG(rating)::numeric, 2)             AS avg,
         COUNT(*) FILTER (WHERE rating = 1)         AS r1,
         COUNT(*) FILTER (WHERE rating = 2)         AS r2,
         COUNT(*) FILTER (WHERE rating = 3)         AS r3,
         COUNT(*) FILTER (WHERE rating = 4)         AS r4,
         COUNT(*) FILTER (WHERE rating = 5)         AS r5
       FROM ratings
       WHERE provider_id = $1`,
      [providerId],
    ),
  ]);

  const stats = statsResult.rows[0];

  return {
    data: dataResult.rows,
    total: parseInt(stats.total, 10),
    averageRating: parseFloat(stats.avg ?? '0'),
    distribution: {
      1: parseInt(stats.r1, 10),
      2: parseInt(stats.r2, 10),
      3: parseInt(stats.r3, 10),
      4: parseInt(stats.r4, 10),
      5: parseInt(stats.r5, 10),
    },
  };
}

/**
 * Find a single rating by ID.
 * Used by admin reports.
 */
export async function findRatingById(id: string): Promise<Rating | null> {
  const { rows } = await db.query<Rating>(
    'SELECT * FROM ratings WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

/**
 * List ratings submitted by a user (their own rating history).
 */
export async function findRatingsByUserId(
  userId: string,
  page: number = 1,
  limit: number = 10,
): Promise<{ data: Rating[]; total: number }> {
  const offset = (page - 1) * limit;

  const [{ rows: data }, { rows: count }] = await Promise.all([
    db.query<Rating>(
      `SELECT * FROM ratings WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
    db.query<{ count: string }>(
      'SELECT COUNT(*) FROM ratings WHERE user_id = $1',
      [userId],
    ),
  ]);

  return { data, total: parseInt(count[0].count, 10) };
}
