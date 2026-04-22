// src/services/matching.service.ts
// Owner: Lead
// Finds the best available provider for a booking request

import { db } from "../config/database";

interface MatchInput {
  serviceId:           string;
  preferredProviderId?: string;
  address:             { lat: number; lng: number };
  scheduledAt:         string | Date;
}

/**
 * Returns a provider UUID or null if none available.
 *
 * Strategy:
 *  1. If caller specified a providerId — verify they're available & serve that service
 *  2. Otherwise — find nearest available provider within their service radius
 *     who has no conflicting booking at scheduledAt
 */
export async function matchProvider(input: MatchInput): Promise<string | null> {
  const { serviceId, preferredProviderId, address, scheduledAt } = input;

  if (preferredProviderId) {
    const provider = await db("providers as p")
      .join("provider_services as ps", "ps.provider_id", "p.id")
      .where("p.id",           preferredProviderId)
      .where("ps.service_id",  serviceId)
      .where("p.is_available", true)
      .whereNotExists(
        db("bookings")
          .whereRaw("provider_id = p.id")
          .whereIn("status", ["confirmed", "in_progress"])
          .whereRaw("scheduled_at BETWEEN ? - INTERVAL '2 hours' AND ? + INTERVAL '2 hours'",
            [scheduledAt, scheduledAt])
      )
      .select("p.id")
      .first();

    return provider?.id ?? null;
  }

  // Auto-match: nearest available provider
  const provider = await db.raw<{ rows: Array<{ id: string }> }>(
    `
    SELECT p.id
    FROM   providers p
    JOIN   provider_services ps ON ps.provider_id = p.id
    WHERE  ps.service_id    = ?
      AND  p.is_available   = TRUE
      AND  ST_DWithin(
             p.location::geography,
             ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
             p.service_radius * 1000
           )
      AND  NOT EXISTS (
             SELECT 1 FROM bookings b
             WHERE  b.provider_id = p.id
               AND  b.status IN ('confirmed', 'in_progress')
               AND  b.scheduled_at BETWEEN ?::timestamptz - INTERVAL '2 hours'
                                       AND ?::timestamptz + INTERVAL '2 hours'
           )
    ORDER BY ST_Distance(
               p.location::geography,
               ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography
             ) ASC
    LIMIT 1
    `,
    [serviceId, address.lng, address.lat, scheduledAt, scheduledAt, address.lng, address.lat]
  );

  return provider.rows[0]?.id ?? null;
}