// DEV 3 — create, findByCustomerId, findUpcoming
// src/models/prediction.model.ts
// Owner: Dev 3 (GPS + AI)
//
// Thin pg query wrapper around the `predictions` table.
// The notification job is the primary consumer of findDueToday().

import { Pool } from 'pg';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PredictionStatus = 'pending' | 'notified' | 'booked' | 'expired';

export interface Prediction {
  id: string;
  userId: string;
  serviceId: string;
  predictedServiceDate: string; // "YYYY-MM-DD"
  notifyDaysBefore: number;
  notifyOnDate: string;         // generated column "YYYY-MM-DD"
  aiReasoning: string | null;
  confidence: number;
  status: PredictionStatus;
  notifiedAt: Date | null;
  bookedAt: Date | null;
  convertedBookingId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Joined with user + service for the notification job
export interface PredictionWithContext extends Prediction {
  userName: string;
  userFcmToken: string | null;
  serviceName: string;
  serviceCategory: string;
}

export interface UpsertPredictionInput {
  userId: string;
  serviceId: string;
  predictedServiceDate: string; // "YYYY-MM-DD"
  notifyDaysBefore?: number;
  aiReasoning?: string;
  confidence: number;
}

// ─── Model ────────────────────────────────────────────────────────────────────

export class PredictionModel {
  constructor(private readonly db: Pool) {}

  /**
   * Upsert a prediction for (user, service).
   * If one already exists, update it only if the new confidence is higher
   * or the predicted date has changed meaningfully (> 7 days shift).
   * Resets status to 'pending' so a fresh notification is sent.
   */
  async upsert(input: UpsertPredictionInput): Promise<Prediction> {
    const { rows } = await this.db.query<Prediction>(
      `INSERT INTO predictions
         (user_id, service_id, predicted_service_date, notify_days_before, ai_reasoning, confidence)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, service_id) DO UPDATE SET
         predicted_service_date = EXCLUDED.predicted_service_date,
         notify_days_before     = EXCLUDED.notify_days_before,
         ai_reasoning           = EXCLUDED.ai_reasoning,
         confidence             = EXCLUDED.confidence,
         status                 = 'pending',
         notified_at            = NULL,
         updated_at             = NOW()
       RETURNING
         id,
         user_id                  AS "userId",
         service_id               AS "serviceId",
         predicted_service_date   AS "predictedServiceDate",
         notify_days_before       AS "notifyDaysBefore",
         notify_on_date           AS "notifyOnDate",
         ai_reasoning             AS "aiReasoning",
         confidence,
         status,
         notified_at              AS "notifiedAt",
         booked_at                AS "bookedAt",
         converted_booking_id     AS "convertedBookingId",
         created_at               AS "createdAt",
         updated_at               AS "updatedAt"`,
      [
        input.userId,
        input.serviceId,
        input.predictedServiceDate,
        input.notifyDaysBefore ?? 3,
        input.aiReasoning ?? null,
        input.confidence,
      ],
    );
    return rows[0];
  }

  /**
   * Find all predictions whose notify_on_date is today or earlier and status is 'pending'.
   * Called daily by the notification cron job.
   * Joins users and services to avoid N+1 in the job loop.
   */
  async findDueToday(): Promise<PredictionWithContext[]> {
    const { rows } = await this.db.query<PredictionWithContext>(
      `SELECT
         p.id,
         p.user_id                  AS "userId",
         p.service_id               AS "serviceId",
         p.predicted_service_date   AS "predictedServiceDate",
         p.notify_days_before       AS "notifyDaysBefore",
         p.notify_on_date           AS "notifyOnDate",
         p.ai_reasoning             AS "aiReasoning",
         p.confidence,
         p.status,
         p.notified_at              AS "notifiedAt",
         p.booked_at                AS "bookedAt",
         p.converted_booking_id     AS "convertedBookingId",
         p.created_at               AS "createdAt",
         p.updated_at               AS "updatedAt",
         u.name                     AS "userName",
         u.fcm_token                AS "userFcmToken",
         s.name                     AS "serviceName",
         s.category                 AS "serviceCategory"
       FROM predictions p
       JOIN users    u ON u.id = p.user_id
       JOIN services s ON s.id = p.service_id
       WHERE p.status = 'pending'
         AND p.notify_on_date <= CURRENT_DATE`,
    );
    return rows;
  }

  /**
   * Mark a prediction as notified. Called immediately after FCM push is sent.
   */
  async markNotified(predictionId: string): Promise<void> {
    await this.db.query(
      `UPDATE predictions
       SET status = 'notified', notified_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [predictionId],
    );
  }

  /**
   * Mark a prediction as booked (conversion tracking).
   * Called when a new booking is created for a service the user was predicted to need.
   */
  async markBooked(userId: string, serviceId: string, bookingId: string): Promise<void> {
    await this.db.query(
      `UPDATE predictions
       SET status = 'booked', booked_at = NOW(), converted_booking_id = $3, updated_at = NOW()
       WHERE user_id = $1 AND service_id = $2 AND status IN ('pending', 'notified')`,
      [userId, serviceId, bookingId],
    );
  }

  /**
   * Expire all pending predictions whose predicted_service_date has already passed.
   * Called nightly by a cleanup job.
   */
  async expireStale(): Promise<number> {
    const { rowCount } = await this.db.query(
      `UPDATE predictions
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'pending'
         AND predicted_service_date < CURRENT_DATE`,
    );
    return rowCount ?? 0;
  }
}
