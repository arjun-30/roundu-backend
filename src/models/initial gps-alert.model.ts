// src/models/gps-alert.model.ts
// Owner: Dev 3 (GPS + AI)

import { Pool } from 'pg';

// ─── Types ───────────────────────────────────────────────────────────────────

export type GpsAlertType =
  | 'route_deviation'
  | 'geofence_exit'
  | 'long_idle'
  | 'speed_anomaly';

export interface GpsAlert {
  id: string;
  bookingId: string;
  providerId: string;
  sessionId: string;
  alertType: GpsAlertType;
  detail: Record<string, unknown>;
  resolved: boolean;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface CreateGpsAlertInput {
  bookingId: string;
  providerId: string;
  sessionId: string;
  alertType: GpsAlertType;
  detail?: Record<string, unknown>;
}

// ─── Model ───────────────────────────────────────────────────────────────────

export class GpsAlertModel {
  constructor(private readonly db: Pool) {}

  async create(input: CreateGpsAlertInput): Promise<GpsAlert> {
    const { rows } = await this.db.query<GpsAlert>(
      `INSERT INTO gps_alerts
         (booking_id, provider_id, session_id, alert_type, detail)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING
         id,
         booking_id   AS "bookingId",
         provider_id  AS "providerId",
         session_id   AS "sessionId",
         alert_type   AS "alertType",
         detail,
         resolved,
         resolved_at  AS "resolvedAt",
         created_at   AS "createdAt"`,
      [
        input.bookingId,
        input.providerId,
        input.sessionId,
        input.alertType,
        JSON.stringify(input.detail ?? {}),
      ],
    );
    return rows[0];
  }

  /**
   * List all alerts for a provider, optionally filtered by resolved status.
   * Used by GET /api/gps/alerts
   */
  async findByProvider(
    providerId: string,
    resolved?: boolean,
  ): Promise<GpsAlert[]> {
    const conditions: string[] = ['provider_id = $1'];
    const params: unknown[] = [providerId];

    if (resolved !== undefined) {
      params.push(resolved);
      conditions.push(`resolved = $${params.length}`);
    }

    const { rows } = await this.db.query<GpsAlert>(
      `SELECT
         id,
         booking_id   AS "bookingId",
         provider_id  AS "providerId",
         session_id   AS "sessionId",
         alert_type   AS "alertType",
         detail,
         resolved,
         resolved_at  AS "resolvedAt",
         created_at   AS "createdAt"
       FROM gps_alerts
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC`,
      params,
    );
    return rows;
  }

  /**
   * Mark an alert as resolved.
   * Used by PATCH /api/gps/alerts/:id/resolve
   */
  async resolve(alertId: string, providerId: string): Promise<GpsAlert | null> {
    const { rows } = await this.db.query<GpsAlert>(
      `UPDATE gps_alerts
       SET resolved = TRUE, resolved_at = NOW()
       WHERE id = $1 AND provider_id = $2
       RETURNING
         id,
         booking_id   AS "bookingId",
         provider_id  AS "providerId",
         session_id   AS "sessionId",
         alert_type   AS "alertType",
         detail,
         resolved,
         resolved_at  AS "resolvedAt",
         created_at   AS "createdAt"`,
      [alertId, providerId],
    );
    return rows[0] ?? null;
  }

  /**
   * Check if an unresolved alert of a specific type already exists for this session.
   * Prevents duplicate alerts for the same ongoing condition.
   */
  async hasOpenAlert(sessionId: string, alertType: GpsAlertType): Promise<boolean> {
    const { rows } = await this.db.query(
      `SELECT 1 FROM gps_alerts
       WHERE session_id = $1 AND alert_type = $2 AND resolved = FALSE
       LIMIT 1`,
      [sessionId, alertType],
    );
    return rows.length > 0;
  }
}
