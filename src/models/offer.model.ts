// DEV 4 — findAll(active), findByCode, create(admin), validateForBooking
// src/models/offer.model.ts
// Manages promotional offers and coupon codes.
// Offers can be global or scoped to a specific service.
// Usage is tracked per user to enforce single-use coupons.
//
// Backs endpoints:
//   GET  /api/offers           — list active offers (public)
//   POST /api/offers/validate  — validate a coupon code (bearer)

import { db } from '../config/database';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DiscountType = 'percentage' | 'flat';

export interface Offer {
  id: string;
  code: string;                  // uppercase coupon code, e.g. 'FIRST50'
  title: string;
  description: string | null;
  discount_type: DiscountType;
  discount_value: number;        // percentage (0–100) or flat amount in paise
  max_discount_amount: number | null;  // cap for percentage discounts (paise)
  min_order_amount: number;      // minimum booking amount to apply (paise)
  service_id: string | null;     // null = applicable to all services
  max_uses: number | null;       // null = unlimited
  uses_per_user: number;         // max times one user can use this offer (default 1)
  total_used: number;            // denormalised usage counter
  valid_from: Date;
  valid_until: Date | null;      // null = no expiry
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface OfferValidationResult {
  valid: boolean;
  discountAmount: number;       // paise to deduct
  discountType: DiscountType;
  offer?: Offer;
  reason?: string;              // why it's invalid
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * List currently active offers.
 * GET /api/offers?serviceId=
 *
 * Returns offers that are active, within their validity window,
 * and not exhausted (total_used < max_uses).
 */
export async function findActiveOffers(serviceId?: string): Promise<Offer[]> {
  const params: unknown[] = [];
  const conditions = [
    'is_active = true',
    '(valid_until IS NULL OR valid_until > now())',
    'valid_from <= now()',
    '(max_uses IS NULL OR total_used < max_uses)',
  ];

  if (serviceId) {
    params.push(serviceId);
    // Global offers (service_id IS NULL) always appear; service-specific offers
    // only appear when they match the requested service.
    conditions.push(`(service_id IS NULL OR service_id = $${params.length})`);
  } else {
    // No service filter — return global offers only.
    conditions.push('service_id IS NULL');
  }

  const { rows } = await db.query<Offer>(
    `SELECT * FROM offers
     WHERE ${conditions.join(' AND ')}
     ORDER BY discount_value DESC`,
    params,
  );
  return rows;
}

/**
 * Find an offer by its coupon code (case-insensitive).
 */
export async function findOfferByCode(code: string): Promise<Offer | null> {
  const { rows } = await db.query<Offer>(
    'SELECT * FROM offers WHERE UPPER(code) = UPPER($1)',
    [code],
  );
  return rows[0] ?? null;
}

/**
 * Count how many times a specific user has used an offer.
 * Used in validate() to enforce uses_per_user limit.
 */
export async function countOfferUsesByUser(
  offerId: string,
  userId: string,
): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*) FROM offer_usages
     WHERE offer_id = $1 AND user_id = $2`,
    [offerId, userId],
  );
  return parseInt(rows[0].count, 10);
}

/**
 * Validate a coupon code against a booking.
 * POST /api/offers/validate
 *
 * Checks (in order):
 *   1. Code exists
 *   2. Offer is active and within validity window
 *   3. Global usage limit not exceeded
 *   4. Per-user usage limit not exceeded
 *   5. Booking meets minimum order amount
 *   6. Service matches (if service-scoped offer)
 *
 * Returns the calculated discount amount in paise.
 * Does NOT apply the offer — call recordOfferUsage() after booking is confirmed.
 */
export async function validateOffer(
  code: string,
  userId: string,
  bookingAmount: number,    // paise
  serviceId?: string,
): Promise<OfferValidationResult> {
  const offer = await findOfferByCode(code);

  if (!offer) {
    return { valid: false, discountAmount: 0, discountType: 'flat', reason: 'Invalid coupon code' };
  }

  if (!offer.is_active) {
    return { valid: false, discountAmount: 0, discountType: offer.discount_type, reason: 'This offer is no longer active', offer };
  }

  const now = new Date();
  if (offer.valid_from > now) {
    return { valid: false, discountAmount: 0, discountType: offer.discount_type, reason: 'This offer has not started yet', offer };
  }
  if (offer.valid_until && offer.valid_until < now) {
    return { valid: false, discountAmount: 0, discountType: offer.discount_type, reason: 'This offer has expired', offer };
  }

  if (offer.max_uses !== null && offer.total_used >= offer.max_uses) {
    return { valid: false, discountAmount: 0, discountType: offer.discount_type, reason: 'This offer has reached its usage limit', offer };
  }

  const userUses = await countOfferUsesByUser(offer.id, userId);
  if (userUses >= offer.uses_per_user) {
    return { valid: false, discountAmount: 0, discountType: offer.discount_type, reason: 'You have already used this offer', offer };
  }

  if (bookingAmount < offer.min_order_amount) {
    const minRupees = (offer.min_order_amount / 100).toFixed(2);
    return { valid: false, discountAmount: 0, discountType: offer.discount_type, reason: `Minimum order amount for this offer is ₹${minRupees}`, offer };
  }

  if (offer.service_id && serviceId && offer.service_id !== serviceId) {
    return { valid: false, discountAmount: 0, discountType: offer.discount_type, reason: 'This offer is not applicable to this service', offer };
  }

  // Calculate discount.
  let discountAmount: number;
  if (offer.discount_type === 'percentage') {
    const raw = Math.floor((bookingAmount * offer.discount_value) / 100);
    discountAmount = offer.max_discount_amount !== null
      ? Math.min(raw, offer.max_discount_amount)
      : raw;
  } else {
    discountAmount = Math.min(offer.discount_value, bookingAmount);
  }

  return {
    valid: true,
    discountAmount,
    discountType: offer.discount_type,
    offer,
  };
}

/**
 * Record that a user has used an offer, and increment the usage counter.
 * Called AFTER a booking is confirmed (not during validation).
 * Wrapped in a transaction to keep total_used consistent.
 */
export async function recordOfferUsage(
  offerId: string,
  userId: string,
  bookingId: string,
): Promise<void> {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO offer_usages (offer_id, user_id, booking_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (offer_id, user_id, booking_id) DO NOTHING`,
      [offerId, userId, bookingId],
    );

    await client.query(
      `UPDATE offers
       SET total_used = total_used + 1, updated_at = now()
       WHERE id = $1`,
      [offerId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
