// EXISTING — CRUD + PostGIS + matchScore + GPS history
// src/models/provider.model.ts
// Represents the provider profile that extends a user with role='provider'.
// One user → one provider row (1:1).
//
// Backs endpoints:
//   GET   /api/providers             — list available providers (bearer)
//   GET   /api/providers/:id         — provider profile + portfolio + ratings
//   PATCH /api/providers/me          — update own profile (provider)
//   GET   /api/providers/me/stats    — earnings & stats (provider)
//
// Uses PostGIS geography type for location — requires the PostGIS extension
// (migration 001_extensions.sql must run first).

import { db } from '../config/database';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Provider {
  id: string;
  user_id: string;
  bio: string | null;
  is_available: boolean;
  is_verified: boolean;         // KYC verified flag
  service_radius_km: number;    // how far they're willing to travel
  avg_rating: number;           // denormalised average, updated after each rating
  total_reviews: number;
  total_bookings: number;
  total_earnings: number;       // paise — lifetime earnings
  lat: number | null;           // last known location (updated via GPS)
  lng: number | null;
  fcm_token: string | null;     // for push notifications
  created_at: Date;
  updated_at: Date;
}

/** Provider row joined with their user profile — used for list/detail views. */
export interface ProviderWithUser extends Provider {
  name: string;
  phone: string;
  avatar: string | null;
  email: string | null;
  // Distance from query point, in km. Only present on proximity searches.
  distance_km?: number;
}

/** Sparse update — only send what changed. */
export interface UpdateProviderInput {
  bio?: string;
  is_available?: boolean;
  service_radius_km?: number;
  lat?: number;
  lng?: number;
  fcm_token?: string;
  is_verified?: boolean;
  avg_rating?: number;
  total_reviews?: number;
  total_bookings?: number;
  total_earnings?: number;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Find a provider by their internal provider UUID.
 * GET /api/providers/:id
 */
export async function findProviderById(id: string): Promise<ProviderWithUser | null> {
  const { rows } = await db.query<ProviderWithUser>(
    `SELECT
       p.*,
       u.name, u.phone, u.avatar, u.email
     FROM providers p
     JOIN users u ON u.id = p.user_id
     WHERE p.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Find a provider by the owning user ID.
 * Used by auth middleware to resolve req.user → provider profile.
 */
export async function findProviderByUserId(
  userId: string,
): Promise<Provider | null> {
  const { rows } = await db.query<Provider>(
    'SELECT * FROM providers WHERE user_id = $1',
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * List available providers near a location, optionally filtered by service.
 *
 * Uses PostGIS ST_DWithin for radius filtering and ST_Distance for ordering.
 * Providers with no location set are excluded from geo searches but returned
 * when lat/lng/radius are omitted.
 *
 * GET /api/providers?serviceId=&lat=&lng=&radius=
 */
export async function findAvailableProviders(filters: {
  serviceId?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
}): Promise<ProviderWithUser[]> {
  const { serviceId, lat, lng, radiusKm = 10 } = filters;
  const params: unknown[] = [];
  const conditions: string[] = ['p.is_available = true', 'p.is_verified = true'];

  // Filter by service capability.
  if (serviceId) {
    params.push(serviceId);
    conditions.push(`EXISTS (
      SELECT 1 FROM provider_services ps
      WHERE ps.provider_id = p.id AND ps.service_id = $${params.length}
    )`);
  }

  // Geo filter — only apply when coordinates are supplied.
  let distanceClause = 'NULL::float AS distance_km';
  let orderClause = 'p.avg_rating DESC';

  if (lat !== undefined && lng !== undefined) {
    params.push(lat, lng, radiusKm * 1000); // PostGIS uses metres
    const pLat = params.length - 2;
    const pLng = params.length - 1;
    const pRadius = params.length;

    conditions.push(
      `ST_DWithin(
         p.location::geography,
         ST_SetSRID(ST_MakePoint($${pLng}, $${pLat}), 4326)::geography,
         $${pRadius}
       )`,
    );

    distanceClause = `
      ROUND(
        ST_Distance(
          p.location::geography,
          ST_SetSRID(ST_MakePoint($${pLng}, $${pLat}), 4326)::geography
        ) / 1000.0,
        2
      )::float AS distance_km`;

    orderClause = 'distance_km ASC, p.avg_rating DESC';
  }

  const where = conditions.join(' AND ');

  const { rows } = await db.query<ProviderWithUser>(
    `SELECT
       p.*,
       u.name, u.phone, u.avatar, u.email,
       ${distanceClause}
     FROM providers p
     JOIN users u ON u.id = p.user_id
     WHERE ${where}
     ORDER BY ${orderClause}
     LIMIT 50`,
    params,
  );
  return rows;
}

/**
 * Update the authenticated provider's own profile.
 * PATCH /api/providers/me
 */
export async function updateProvider(
  id: string,
  updates: UpdateProviderInput,
): Promise<Provider | null> {
  const fieldMap: Record<string, string> = {
    is_available: 'is_available',
    bio: 'bio',
    service_radius_km: 'service_radius_km',
    fcm_token: 'fcm_token',
    is_verified: 'is_verified',
    avg_rating: 'avg_rating',
    total_reviews: 'total_reviews',
    total_bookings: 'total_bookings',
    total_earnings: 'total_earnings',
  };

  // Handle location separately — stored as a PostGIS geography point.
  const { lat, lng, ...rest } = updates;
  const entries = Object.entries(rest).filter(([, v]) => v !== undefined);

  const setClauses: string[] = entries.map(([k], i) => `${fieldMap[k] ?? k} = $${i + 2}`);
  const values: unknown[] = entries.map(([, v]) => v);

  // Append location update if coordinates were provided.
  if (lat !== undefined && lng !== undefined) {
    values.push(lat, lng);
    setClauses.push(
      `location = ST_SetSRID(ST_MakePoint($${values.length}, $${values.length - 1}), 4326)`,
    );
    setClauses.push(`lat = $${values.length - 1}`, `lng = $${values.length}`);
  }

  if (setClauses.length === 0) return findProviderById(id);

  const { rows } = await db.query<Provider>(
    `UPDATE providers
     SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return rows[0] ?? null;
}

/**
 * Provider earnings and activity stats.
 * GET /api/providers/me/stats?from=&to=
 */
export async function getProviderStats(
  providerId: string,
  from?: string,
  to?: string,
): Promise<{
  totalEarnings: number;
  totalBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  avgRating: number;
  periodEarnings: number;
}> {
  const params: unknown[] = [providerId];
  let dateFilter = '';

  if (from && to) {
    params.push(from, to);
    dateFilter = `AND b.created_at BETWEEN $${params.length - 1} AND $${params.length}`;
  }

  const [providerRow, periodRow] = await Promise.all([
    db.query<{
      avg_rating: number;
      total_bookings: number;
      total_earnings: number;
    }>(
      'SELECT avg_rating, total_bookings, total_earnings FROM providers WHERE id = $1',
      [providerId],
    ),
    db.query<{
      completed: string;
      cancelled: string;
      period_earnings: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE b.status = 'completed')  AS completed,
         COUNT(*) FILTER (WHERE b.status = 'cancelled')  AS cancelled,
         COALESCE(SUM(b.total_amount) FILTER (WHERE b.status = 'completed'), 0) AS period_earnings
       FROM bookings b
       WHERE b.provider_id = $1 ${dateFilter}`,
      params,
    ),
  ]);

  const p = providerRow.rows[0];
  const s = periodRow.rows[0];

  return {
    totalEarnings: p?.total_earnings ?? 0,
    totalBookings: p?.total_bookings ?? 0,
    completedBookings: parseInt(s?.completed ?? '0', 10),
    cancelledBookings: parseInt(s?.cancelled ?? '0', 10),
    avgRating: parseFloat(String(p?.avg_rating ?? '0')),
    periodEarnings: parseInt(s?.period_earnings ?? '0', 10),
  };
}

/**
 * Atomically recalculate and persist avg_rating + total_reviews.
 * Called by rating.model.ts after every new rating insert.
 */
export async function refreshProviderRating(providerId: string): Promise<void> {
  await db.query(
    `UPDATE providers p
     SET
       avg_rating    = sub.avg,
       total_reviews = sub.cnt,
       updated_at    = now()
     FROM (
       SELECT
         ROUND(AVG(rating)::numeric, 2) AS avg,
         COUNT(*)                        AS cnt
       FROM ratings
       WHERE provider_id = $1
     ) sub
     WHERE p.id = $1`,
    [providerId],
  );
}

/**
 * Increment total_bookings counter (called when a new booking is created).
 */
export async function incrementProviderBookingCount(
  providerId: string,
): Promise<void> {
  await db.query(
    `UPDATE providers
     SET total_bookings = total_bookings + 1, updated_at = now()
     WHERE id = $1`,
    [providerId],
  );
}
