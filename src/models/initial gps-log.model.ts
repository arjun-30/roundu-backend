// src/models/gps-log.model.ts
// Owner: Dev 3 (GPS + AI)
// Thin query wrapper around the gps_logs table.
// All heavy geo-queries live in gps-monitor.service.ts — this file only handles CRUD.

import { Pool } from 'pg';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GpsLog {
  id: string;
  bookingId: string;
  providerId: string;
  sessionId: string;
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  recordedAt: Date;
  createdAt: Date;
}

export interface CreateGpsLogInput {
  bookingId: string;
  providerId: string;
  sessionId: string;
  lat: number;
  lng: number;
  accuracyMeters?: number;
}

// ─── Model ───────────────────────────────────────────────────────────────────

export class GpsLogModel {
  constructor(private readonly db: Pool) {}

  /**
   * Persist a single GPS ping.
   * PostGIS geography point: ST_MakePoint(lng, lat) — note: X=lng, Y=lat convention.
   */
  async create(input: CreateGpsLogInput): Promise<GpsLog> {
    const { rows } = await this.db.query<GpsLog>(
      `INSERT INTO gps_logs
         (booking_id, provider_id, session_id, location, accuracy_meters)
       VALUES
         ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6)
       RETURNING
         id,
         booking_id        AS "bookingId",
         provider_id       AS "providerId",
         session_id        AS "sessionId",
         ST_Y(location::geometry) AS lat,
         ST_X(location::geometry) AS lng,
         accuracy_meters   AS "accuracyMeters",
         recorded_at       AS "recordedAt",
         created_at        AS "createdAt"`,
      [
        input.bookingId,
        input.providerId,
        input.sessionId,
        input.lat,
        input.lng,
        input.accuracyMeters ?? null,
      ],
    );
    return rows[0];
  }

  /**
   * Fetch all GPS points for a booking, newest-first.
   * Used by GET /api/gps/logs/:bookingId.
   */
  async findByBooking(bookingId: string): Promise<GpsLog[]> {
    const { rows } = await this.db.query<GpsLog>(
      `SELECT
         id,
         booking_id        AS "bookingId",
         provider_id       AS "providerId",
         session_id        AS "sessionId",
         ST_Y(location::geometry) AS lat,
         ST_X(location::geometry) AS lng,
         accuracy_meters   AS "accuracyMeters",
         recorded_at       AS "recordedAt",
         created_at        AS "createdAt"
       FROM gps_logs
       WHERE booking_id = $1
       ORDER BY recorded_at DESC`,
      [bookingId],
    );
    return rows;
  }

  /**
   * Fetch the most recent N pings for a session.
   * Used by gps-monitor.service for idle / speed anomaly detection.
   */
  async findRecentBySession(sessionId: string, limit = 5): Promise<GpsLog[]> {
    const { rows } = await this.db.query<GpsLog>(
      `SELECT
         id,
         booking_id        AS "bookingId",
         provider_id       AS "providerId",
         session_id        AS "sessionId",
         ST_Y(location::geometry) AS lat,
         ST_X(location::geometry) AS lng,
         accuracy_meters   AS "accuracyMeters",
         recorded_at       AS "recordedAt",
         created_at        AS "createdAt"
       FROM gps_logs
       WHERE session_id = $1
       ORDER BY recorded_at DESC
       LIMIT $2`,
      [sessionId, limit],
    );
    return rows;
  }
}
