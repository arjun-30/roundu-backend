// DEV 3 — getForUser, refreshRecommendations
// src/controllers/recommendation.controller.ts
// Owner: Dev 3 (GPS + AI)
//
// Handles:
//   GET  /api/recommendations              → personalized recommendations for user
//   POST /api/recommendations/feedback     → record clicked / booked / dismissed

import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { RecommendationModel } from '../models/recommendation.model';
import { RecommendationService } from '../services/recommendation.service';
import { pool } from '../config/database';
import { sendSuccess } from '../utils/response';
import {
  getRecommendationsQuerySchema,
  recommendationFeedbackSchema,
} from '../validators/recommendation.validator';
import { logger } from '../utils/logger';

const recommendationModel = new RecommendationModel(pool);
const recommendationService = new RecommendationService(pool);

// ─── GET /api/recommendations ─────────────────────────────────────────────────

/**
 * Returns the latest AI-generated recommendations for the authenticated user.
 *
 * On-demand generation:
 *   If no recommendations exist yet (new user who just completed their first
 *   booking), we generate them synchronously so the response is never empty.
 *   Subsequent calls serve from the pre-computed batch, keeping p95 latency low.
 *
 * Auth: bearer
 */
export async function getRecommendations(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { limit } = getRecommendationsQuerySchema.parse(req.query);
    const userId = (req as any).user.id;

    let recommendations = await recommendationModel.findForUser(userId, limit);

    // On-demand generation for new users with no pre-computed recommendations
    if (!recommendations.length) {
      logger.info({ userId }, 'No cached recommendations — running engine on-demand');
      try {
        await recommendationService.runForUser(userId);
        recommendations = await recommendationModel.findForUser(userId, limit);
      } catch (err) {
        // If on-demand generation fails, return empty array — never crash the endpoint
        logger.error({ err, userId }, 'On-demand recommendation generation failed');
      }
    }

    sendSuccess(res, recommendations, 'Recommendations retrieved');
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/recommendations/feedback ──────────────────────────────────────

/**
 * Records user feedback (clicked / booked / dismissed) for a recommendation.
 * This closes the AI feedback loop — logged actions are used to measure model quality.
 *
 * For 'booked' actions, we also update the prediction table to mark conversion.
 *
 * Auth: bearer
 */
export async function submitFeedback(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { recommendationId, action } = recommendationFeedbackSchema.parse(req.body);
    const userId = (req as any).user.id;

    const updated = await recommendationModel.recordFeedback(
      recommendationId,
      userId,
      action,
    );

    if (!updated) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Recommendation not found or does not belong to you',
          details: {},
        },
      });
      return;
    }

    sendSuccess(res, { recorded: true }, 'Feedback recorded');
  } catch (err) {
    next(err);
  }
}
