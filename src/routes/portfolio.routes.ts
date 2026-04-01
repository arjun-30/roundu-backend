// DEV 4
// src/routes/portfolio.routes.ts
// Manages provider portfolio items (before/after photos, work samples).
//
// Endpoints:
//   GET    /api/portfolio/:providerId  — list portfolio items (public)
//   POST   /api/portfolio              — add portfolio item (provider)
//   DELETE /api/portfolio/:id          — remove portfolio item (provider)
//
// Business rules enforced here:
//   - Only the owning provider can add/delete their own items.
//   - Max 20 portfolio items per provider (configurable cap).
//   - imageUrl must be a valid S3 URL from our bucket (prevents hotlinking).
//   - On delete, the deleted item's imageKey is returned so S3 cleanup can run.
//
// Upload flow:
//   Client → POST /api/upload/presigned (get S3 URL) → upload to S3
//          → POST /api/portfolio        (save the fileUrl returned by presigned)
//
// API Contract ref: §16 Portfolio

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import {
  findPortfolioByProviderId,
  findPortfolioItemById,
  createPortfolioItem,
  deletePortfolioItem,
  countPortfolioItems,
} from '../models/portfolio.model';
import { findProviderByUserId } from '../models/provider.model';
import { deleteS3Object } from '../services/s3.service';
import { sendSuccess, sendError } from '../utils/response';
import { logger } from '../utils/logger';
import { env } from '../config/env';

const router = Router();

// Maximum portfolio items per provider.
const MAX_PORTFOLIO_ITEMS = 20;

// ─── Validation Schemas ───────────────────────────────────────────────────────

const createPortfolioSchema = z.object({
  body: z.object({
    title: z
      .string({ required_error: 'title is required' })
      .min(1, 'title cannot be empty')
      .max(100, 'title must be 100 characters or less'),

    imageUrl: z
      .string({ required_error: 'imageUrl is required' })
      .url('imageUrl must be a valid URL')
      // Ensure the URL belongs to our own S3 bucket, not an external source.
      .refine(
        (url) => url.startsWith(`https://${env.S3_BUCKET_NAME}`),
        { message: 'imageUrl must be a URL from our storage bucket' },
      ),

    description: z
      .string()
      .max(500, 'description must be 500 characters or less')
      .optional(),
  }),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the authenticated user → their provider profile.
 * Needed to get the provider.id from req.user.id (which is a user UUID).
 */
async function resolveProvider(userId: string) {
  const provider = await findProviderByUserId(userId);
  if (!provider) {
    throw Object.assign(new Error('Provider profile not found'), {
      code: 'NOT_FOUND',
      statusCode: 404,
    });
  }
  return provider;
}

/**
 * Extract the S3 object key from a full S3 URL.
 * e.g. "https://bucket.s3.ap-south-1.amazonaws.com/portfolio/user-id/img.jpg"
 *       → "portfolio/user-id/img.jpg"
 */
function extractS3Key(url: string): string {
  try {
    const parsed = new URL(url);
    // pathname starts with '/', so slice(1) removes the leading slash.
    return parsed.pathname.slice(1);
  } catch {
    return '';
  }
}

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * GET /api/portfolio/:providerId
 *
 * List all portfolio items for a provider.
 * Auth: public — visible to anyone browsing the provider's profile.
 */
async function getPortfolio(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { providerId } = req.params;
    const items = await findPortfolioByProviderId(providerId);
    sendSuccess(res, 200, items);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/portfolio
 *
 * Add a portfolio item for the authenticated provider.
 * Auth: provider
 *
 * Guards:
 *   - User must have role 'provider'.
 *   - Portfolio item cap not exceeded.
 */
async function addPortfolioItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const provider = await resolveProvider(req.user!.id);

    // Enforce cap.
    const count = await countPortfolioItems(provider.id);
    if (count >= MAX_PORTFOLIO_ITEMS) {
      sendError(
        res, 422, 'UNPROCESSABLE',
        `Portfolio is full. Maximum ${MAX_PORTFOLIO_ITEMS} items allowed. ` +
        'Please delete an existing item before adding a new one.',
      );
      return;
    }

    const { title, imageUrl, description } = req.body as {
      title: string;
      imageUrl: string;
      description?: string;
    };

    // Extract the S3 key from the URL — stored for later S3 deletion.
    const imageKey = extractS3Key(imageUrl);

    const item = await createPortfolioItem({
      provider_id: provider.id,
      title,
      image_url: imageUrl,
      image_key: imageKey,
      description,
    });

    logger.info('Portfolio item added', {
      itemId: item.id,
      providerId: provider.id,
    });

    sendSuccess(res, 201, item, undefined, 'Portfolio item added successfully');
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/portfolio/:id
 *
 * Remove a portfolio item.
 * Auth: provider — only the owning provider can delete.
 *
 * On success: the S3 object is also deleted (best-effort, non-fatal if it fails).
 */
async function removePortfolioItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const provider = await resolveProvider(req.user!.id);
    const itemId = req.params.id;

    // Verify the item exists first (to give a clear 404 vs silent no-op).
    const existing = await findPortfolioItemById(itemId);
    if (!existing) {
      sendError(res, 404, 'NOT_FOUND', 'Portfolio item not found');
      return;
    }

    // deletePortfolioItem also checks provider ownership in the WHERE clause.
    const deleted = await deletePortfolioItem(itemId, provider.id);
    if (!deleted) {
      sendError(res, 403, 'FORBIDDEN', 'You can only delete your own portfolio items');
      return;
    }

    // Best-effort S3 cleanup — don't fail the request if S3 delete fails.
    if (deleted.image_key) {
      deleteS3Object(deleted.image_key).catch((err) => {
        logger.error('Failed to delete S3 object for portfolio item', {
          imageKey: deleted.image_key,
          err,
        });
      });
    }

    logger.info('Portfolio item deleted', {
      itemId,
      providerId: provider.id,
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ─── Route Registration ───────────────────────────────────────────────────────

/**
 * GET /api/portfolio/:providerId
 * Public — no auth required.
 */
router.get('/:providerId', getPortfolio);

/**
 * POST /api/portfolio
 * Provider only — auth + role check.
 */
router.post(
  '/',
  auth,
  requireRole('provider'),
  validate(createPortfolioSchema),
  addPortfolioItem,
);

/**
 * DELETE /api/portfolio/:id
 * Provider only — auth + role check + ownership guard in controller.
 */
router.delete(
  '/:id',
  auth,
  requireRole('provider'),
  removePortfolioItem,
);

export default router;
