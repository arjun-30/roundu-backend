// DEV 4
// src/validators/portfolio.validator.ts
// Zod schemas for all /api/portfolio endpoints.
//
// Consumed by:
//   portfolio.routes.ts  → validate(schema) middleware
//   portfolio.controller.ts → TypeScript types for req.body / req.params
//
// Endpoints covered:
//   GET    /api/portfolio/:providerId  — list items (public)
//   POST   /api/portfolio              — add item (provider)
//   DELETE /api/portfolio/:id          — remove item (provider)
//
// API Contract ref: §16 Portfolio

import { z } from 'zod';
import { env } from '../config/env';

// ─── Shared Primitives ────────────────────────────────────────────────────────

/**
 * S3 image URL validator.
 *
 * Validates that:
 *   1. The value is a syntactically valid URL.
 *   2. The URL belongs to our own S3 bucket (prevents hotlinking external images).
 *
 * The bucket hostname pattern covers both path-style and virtual-hosted-style URLs:
 *   Virtual-hosted: https://{bucket}.s3.{region}.amazonaws.com/key
 *   Path-style:     https://s3.{region}.amazonaws.com/{bucket}/key
 *
 * Exported so upload.validator.ts can reuse the same refinement.
 */
export const s3ImageUrlSchema = z
  .string()
  .url('Must be a valid URL')
  .refine(
    (url) => {
      const bucketName = env.S3_BUCKET_NAME;
      // Accept both URL styles.
      return (
        url.includes(`${bucketName}.s3.`) ||   // virtual-hosted
        url.includes(`amazonaws.com/${bucketName}/`) // path-style
      );
    },
    { message: 'imageUrl must be a URL from our storage bucket' },
  );

// ─── GET /api/portfolio/:providerId ──────────────────────────────────────────

/**
 * Validates the :providerId route param.
 * Auth: public
 */
export const getPortfolioSchema = z.object({
  params: z.object({
    providerId: z
      .string({ required_error: 'providerId is required' })
      .uuid('providerId must be a valid UUID'),
  }),
});

export type GetPortfolioParams = z.infer<typeof getPortfolioSchema>['params'];

// ─── POST /api/portfolio ──────────────────────────────────────────────────────

/**
 * Validates the request body when a provider adds a portfolio item.
 * Auth: provider
 *
 * Fields:
 *   title       — display name shown on the portfolio card
 *   imageUrl    — S3 URL obtained from POST /api/upload/presigned
 *   description — optional caption / context for the photo
 */
export const createPortfolioSchema = z.object({
  body: z.object({
    title: z
      .string({ required_error: 'title is required' })
      .min(1, 'title cannot be empty')
      .max(100, 'title must be 100 characters or less')
      .trim(),

    imageUrl: s3ImageUrlSchema.describe(
      'S3 URL returned by POST /api/upload/presigned with purpose=portfolio',
    ),

    description: z
      .string()
      .max(500, 'description must be 500 characters or less')
      .trim()
      .optional(),
  }),
});

export type CreatePortfolioInput = z.infer<typeof createPortfolioSchema>['body'];

// ─── DELETE /api/portfolio/:id ────────────────────────────────────────────────

/**
 * Validates the :id route param on deletion.
 * Auth: provider (ownership verified in controller)
 */
export const deletePortfolioSchema = z.object({
  params: z.object({
    id: z
      .string({ required_error: 'Portfolio item id is required' })
      .uuid('Portfolio item id must be a valid UUID'),
  }),
});

export type DeletePortfolioParams = z.infer<typeof deletePortfolioSchema>['params'];
