// DEV 3 — create, findByBookingId, findByProviderId
// src/models/service-report.model.ts
// Stores post-service reports filed by providers after completing a booking.
// Contains work description, materials used, and photo evidence.
// One report per booking (enforced by UNIQUE constraint on booking_id).
//
// Backs endpoints:
//   POST /api/service-reports              — submit report (provider)
//   GET  /api/service-reports/:bookingId   — get report for a booking (bearer)

import { db } from '../config/database';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MaterialUsed {
  name: string;
  quantity: number;
  unit: string;     // 'pcs', 'kg', 'litre', etc.
  cost?: number;    // paise — optional, for provider's own record
}

export interface ServiceReport {
  id: string;
  booking_id: string;
  provider_id: string;
  work_done: string;
  materials: MaterialUsed[];   // stored as JSONB array
  photos: string[];            // S3 URLs, stored as TEXT[]
  notes: string | null;        // internal notes (not shown to user)
  created_at: Date;
  updated_at: Date;
}

/** Report with booking context — for the user-facing GET endpoint. */
export interface ServiceReportWithContext extends ServiceReport {
  service_name: string;
  provider_name: string;
  booking_scheduled_at: Date;
}

export interface CreateServiceReportInput {
  booking_id: string;
  provider_id: string;
  work_done: string;
  materials?: MaterialUsed[];
  photos?: string[];
  notes?: string;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Submit a new service report.
 * POST /api/service-reports
 *
 * Constraints checked before calling this:
 *   - Booking must be in 'completed' status.
 *   - provider_id must match the booking's assigned provider.
 *   - Only one report per booking (UNIQUE constraint returns 23505 on duplicate).
 */
export async function createServiceReport(
  input: CreateServiceReportInput,
): Promise<ServiceReport> {
  const { rows } = await db.query<ServiceReport>(
    `INSERT INTO service_reports
       (booking_id, provider_id, work_done, materials, photos, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.booking_id,
      input.provider_id,
      input.work_done,
      JSON.stringify(input.materials ?? []),
      input.photos ?? [],
      input.notes ?? null,
    ],
  );
  return rows[0];
}

/**
 * Get the service report for a booking.
 * GET /api/service-reports/:bookingId
 *
 * Joined with booking + service + provider for full display context.
 * Accessible by the booking's user AND the provider (checked by controller).
 */
export async function findReportByBookingId(
  bookingId: string,
): Promise<ServiceReportWithContext | null> {
  const { rows } = await db.query<ServiceReportWithContext>(
    `SELECT
       sr.*,
       s.name          AS service_name,
       u.name          AS provider_name,
       b.scheduled_at  AS booking_scheduled_at
     FROM service_reports sr
     JOIN bookings  b ON b.id = sr.booking_id
     JOIN services  s ON s.id = b.service_id
     JOIN providers p ON p.id = sr.provider_id
     JOIN users     u ON u.id = p.user_id
     WHERE sr.booking_id = $1`,
    [bookingId],
  );
  return rows[0] ?? null;
}

/**
 * Find a report by its own ID.
 */
export async function findReportById(id: string): Promise<ServiceReport | null> {
  const { rows } = await db.query<ServiceReport>(
    'SELECT * FROM service_reports WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Check whether a report already exists for a booking.
 * Used by the controller to return 409 CONFLICT before attempting insert.
 */
export async function reportExistsForBooking(bookingId: string): Promise<boolean> {
  const { rows } = await db.query<{ count: string }>(
    'SELECT COUNT(*) FROM service_reports WHERE booking_id = $1',
    [bookingId],
  );
  return parseInt(rows[0].count, 10) > 0;
}

/**
 * List all reports submitted by a provider (paginated).
 * Used by admin and provider analytics.
 */
export async function findReportsByProviderId(
  providerId: string,
  page: number = 1,
  limit: number = 10,
): Promise<{ data: ServiceReport[]; total: number }> {
  const offset = (page - 1) * limit;

  const [{ rows: data }, { rows: count }] = await Promise.all([
    db.query<ServiceReport>(
      `SELECT * FROM service_reports
       WHERE provider_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [providerId, limit, offset],
    ),
    db.query<{ count: string }>(
      'SELECT COUNT(*) FROM service_reports WHERE provider_id = $1',
      [providerId],
    ),
  ]);

  return { data, total: parseInt(count[0].count, 10) };
}

/**
 * Add a photo to an existing report (S3 URL appended to the photos array).
 * Used if the provider uploads additional photos after the initial report.
 */
export async function appendReportPhoto(
  reportId: string,
  photoUrl: string,
): Promise<ServiceReport | null> {
  const { rows } = await db.query<ServiceReport>(
    `UPDATE service_reports
     SET
       photos     = array_append(photos, $2),
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [reportId, photoUrl],
  );
  return rows[0] ?? null;
}
