// DEV 3 — upsertForUser, findByUserId
// src/models/recommendation.model.ts
// Owner: Dev 3 (GPS + AI)
//
// Thin pg query wrapper around the `recommendations` table.
// Business logic lives in recommendation.service.ts — this file is pure SQL.

import { Pool } from 'pg';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RecommendationAction = 'pending' | 'clicked' | 'booked' | 'dismissed';

export interface Recommendation {
  id: string;
  userId: string;
  serviceId: string;
  reason: string;
  score: number;
  predictedDate: string | null; // ISO date string e.g. "2025-09-15"
  action: RecommendationAction;
  actionRecordedAt: Date | null;
  engineRunId: string;
  createdAt: Date;
  updatedAt: Date;
}

// Joined view returned to the API consumer — includes service name/category
export interface RecommendationWithService extends Recommendation {
  serviceName: string;
  serviceCategory: string;
}

export interface CreateRecommendationInput {
  userId: string;
  serviceId: string;
  reason: string;
  score: number;
  predictedDate?: string; // ISO date "YYYY-MM-DD"
  engineRunId: string;
}

// ─── Model ────────────────────────────────────────────────────────────────────

export class RecommendationModel {
  constructor(private readonly db: Pool) {}

  /**
   * Bulk-insert a batch of recommendations produced by a single engine run.
   * Uses a single multi-row INSERT for efficiency.
   */
  async bulkCreate(items: CreateRecommendationInput[]): Promise<void> {
    if (!items.length) return;

    // Build parameterised multi-row VALUES clause
    const values: unknown[] = [];
    const placeholders = items.map((item, i) => {
      const base = i * 6;
      values.push(
        item.userId,
        item.serviceId,
        item.reason,
        item.score,
        item.predictedDate ?? null,
        item.engineRunId,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    });

    await this.db.query(
      `INSERT INTO recommendations
         (user_id, service_id, reason, score, predicted_date, engine_run_id)
       VALUES ${placeholders.join(', ')}`,
      values,
    );
  }

  /**
   * Fetch the most recent recommendations for a user.
   * Only returns rows from the latest engine run (highest created_at batch).
   * Used by GET /api/recommendations.
   */
  async findForUser(
    userId: string,
    limit: number = 10,
  ): Promise<RecommendationWithService[]> {
    const { rows } = await this.db.query<RecommendationWithService>(
      `WITH latest_run AS (
         SELECT engine_run_id
         FROM recommendations
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 1
       )
       SELECT
         r.id,
         r.user_id              AS "userId",
         r.service_id           AS "serviceId",
         r.reason,
         r.score,
         r.predicted_date       AS "predictedDate",
         r.action,
         r.action_recorded_at   AS "actionRecordedAt",
         r.engine_run_id        AS "engineRunId",
         r.created_at           AS "createdAt",
         r.updated_at           AS "updatedAt",
         s.name                 AS "serviceName",
         s.category             AS "serviceCategory"
       FROM recommendations r
       JOIN services s ON s.id = r.service_id
       WHERE r.user_id = $1
         AND r.engine_run_id = (SELECT engine_run_id FROM latest_run)
         AND r.action != 'dismissed'
       ORDER BY r.score DESC
       LIMIT $2`,
      [userId, limit],
    );
    return rows;
  }

  /**
   * Record user feedback on a recommendation.
   * Used by POST /api/recommendations/feedback.
   */
  async recordFeedback(
    recommendationId: string,
    userId: string,
    action: RecommendationAction,
  ): Promise<Recommendation | null> {
    const { rows } = await this.db.query<Recommendation>(
      `UPDATE recommendations
       SET action = $3, action_recorded_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING
         id,
         user_id              AS "userId",
         service_id           AS "serviceId",
         reason,
         score,
         predicted_date       AS "predictedDate",
         action,
         action_recorded_at   AS "actionRecordedAt",
         engine_run_id        AS "engineRunId",
         created_at           AS "createdAt",
         updated_at           AS "updatedAt"`,
      [recommendationId, userId, action],
    );
    return rows[0] ?? null;
  }

  /**
   * Delete all previous engine runs for a user before inserting a fresh batch.
   * Prevents stale recommendations from surfacing.
   */
  async deleteOldRuns(userId: string, keepRunId: string): Promise<void> {
    await this.db.query(
      `DELETE FROM recommendations
       WHERE user_id = $1 AND engine_run_id != $2`,
      [userId, keepRunId],
    );
  }
}
