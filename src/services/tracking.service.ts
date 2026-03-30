// Owner: Dev 4 — Referrals + Offers + Portfolio + Tracking
// Service: tracking.service.ts

import { Pool } from 'pg';
import { Server as SocketServer } from 'socket.io';
import {
  TrackingSession,
  LocationPoint,
  SessionSummary,
} from '../models/tracking-session.model';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function assertSessionOwner(
  db: Pool,
  sessionId: string,
  providerId: string,
): Promise<TrackingSession> {
  const result = await db.query<TrackingSession>(
    `SELECT * FROM tracking_sessions WHERE id = $1`,
    [sessionId],
  );

  if (result.rows.length === 0) {
    throw Object.assign(new Error('Tracking session not found'), {
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  }

  const session = result.rows[0];

  if (session.providerId !== providerId) {
    throw Object.assign(new Error('Forbidden — not your session'), {
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  }

  return session;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Start a new tracking session for a booking.
 * Only one active session per booking is allowed.
 */
export async function startSession(
  db: Pool,
  providerId: string,
  bookingId: string,
): Promise<{ sessionId: string }> {
  // Validate booking belongs to provider and is in a trackable state
  const booking = await db.query<{ id: string; provider_id: string; status: string }>(
    `SELECT id, provider_id, status FROM bookings WHERE id = $1`,
    [bookingId],
  );

  if (booking.rows.length === 0) {
    throw Object.assign(new Error('Booking not found'), {
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  }

  const b = booking.rows[0];

  if (b.provider_id !== providerId) {
    throw Object.assign(new Error('This booking does not belong to you'), {
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  }

  if (!['confirmed', 'in_progress'].includes(b.status)) {
    throw Object.assign(
      new Error('Tracking can only be started for confirmed or in-progress bookings'),
      { statusCode: 422, code: 'UNPROCESSABLE' },
    );
  }

  // Prevent duplicate active sessions
  const existing = await db.query(
    `SELECT id FROM tracking_sessions
     WHERE booking_id = $1 AND status = 'active'`,
    [bookingId],
  );

  if (existing.rows.length > 0) {
    throw Object.assign(new Error('An active tracking session already exists'), {
      statusCode: 409,
      code: 'CONFLICT',
    });
  }

  const result = await db.query<{ id: string }>(
    `INSERT INTO tracking_sessions (booking_id, provider_id, status)
     VALUES ($1, $2, 'active')
     RETURNING id`,
    [bookingId, providerId],
  );

  return { sessionId: result.rows[0].id };
}

/**
 * Log a GPS location update and emit WebSocket event to the user.
 * Fires: provider:location_updated → { bookingId, lat, lng }
 */
export async function updateLocation(
  db: Pool,
  io: SocketServer,
  providerId: string,
  sessionId: string,
  lat: number,
  lng: number,
  accuracy?: number,
): Promise<void> {
  const session = await assertSessionOwner(db, sessionId, providerId);

  if (session.status === 'ended') {
    throw Object.assign(new Error('Session has already ended'), {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  }

  // Persist location point
  await db.query(
    `INSERT INTO tracking_locations (session_id, lat, lng, accuracy)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, lat, lng, accuracy ?? null],
  );

  // Update last known location on the session row
  await db.query(
    `UPDATE tracking_sessions
     SET last_lat = $1, last_lng = $2, last_updated_at = NOW()
     WHERE id = $3`,
    [lat, lng, sessionId],
  );

  // Emit WebSocket event to the user's room (room key = bookingId)
  // The socket handler joins users to room `booking:<bookingId>` on connect
  io.to(`booking:${session.bookingId}`).emit('provider:location_updated', {
    bookingId: session.bookingId,
    lat,
    lng,
  });
}

/**
 * Get a tracking session with its last known location.
 */
export async function getSession(
  db: Pool,
  sessionId: string,
): Promise<TrackingSession> {
  const result = await db.query<TrackingSession>(
    `SELECT
       id,
       booking_id   AS "bookingId",
       provider_id  AS "providerId",
       status,
       started_at   AS "startedAt",
       ended_at     AS "endedAt",
       last_lat     AS "lastLat",
       last_lng     AS "lastLng",
       last_updated_at AS "lastUpdatedAt"
     FROM tracking_sessions
     WHERE id = $1`,
    [sessionId],
  );

  if (result.rows.length === 0) {
    throw Object.assign(new Error('Tracking session not found'), {
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  }

  return result.rows[0];
}

/**
 * End an active tracking session and return a summary.
 */
export async function endSession(
  db: Pool,
  providerId: string,
  sessionId: string,
): Promise<SessionSummary> {
  const session = await assertSessionOwner(db, sessionId, providerId);

  if (session.status === 'ended') {
    throw Object.assign(new Error('Session is already ended'), {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  }

  await db.query(
    `UPDATE tracking_sessions
     SET status = 'ended', ended_at = NOW()
     WHERE id = $1`,
    [sessionId],
  );

  // Count total GPS points logged
  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) FROM tracking_locations WHERE session_id = $1`,
    [sessionId],
  );

  const endedAt = new Date();
  const durationMs = endedAt.getTime() - new Date(session.startedAt).getTime();

  return {
    sessionId,
    bookingId: session.bookingId,
    startedAt: session.startedAt,
    endedAt,
    totalPoints: parseInt(countResult.rows[0].count, 10),
    durationMinutes: Math.round(durationMs / 60000),
  };
}