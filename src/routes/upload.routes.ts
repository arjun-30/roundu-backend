// EXISTING
// src/routes/upload.routes.ts
// Handles S3 presigned URL generation for client-side file uploads.
//
// Flow:
//   1. Client calls POST /api/upload/presigned with filename + contentType + purpose
//   2. Server generates a short-lived S3 presigned PUT URL
//   3. Client uploads the file directly to S3 (never through this server)
//   4. Client gets back the final S3 file URL to store on the record
//      (e.g. portfolio item imageUrl, provider avatar, KYC document)
//
// Backed by: src/services/s3.service.ts
//
// Endpoints:
//   POST /api/upload/presigned   — get S3 presigned upload URL (bearer)
//
// API Contract ref: §18 Uploads

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { generatePresignedUploadUrl } from '../services/s3.service';
import { sendSuccess, sendError } from '../utils/response';
import { logger } from '../utils/logger';

const router = Router();

// ─── Validation Schema ────────────────────────────────────────────────────────

/**
 * Allowed upload purposes — controls which S3 prefix/bucket folder the file lands in.
 *
 * avatar    → uploads/avatars/
 * portfolio → uploads/portfolio/
 * document  → uploads/kyc-documents/   (provider KYC docs — private bucket ACL)
 * report    → uploads/service-reports/
 */
const ALLOWED_PURPOSES = ['avatar', 'portfolio', 'document', 'report'] as const;
type UploadPurpose = (typeof ALLOWED_PURPOSES)[number];

/**
 * MIME types allowed per purpose.
 * Prevents uploading executables or unexpected file types.
 */
const ALLOWED_MIME_TYPES: Record<UploadPurpose, string[]> = {
  avatar:    ['image/jpeg', 'image/png', 'image/webp'],
  portfolio: ['image/jpeg', 'image/png', 'image/webp'],
  document:  ['image/jpeg', 'image/png', 'application/pdf'],
  report:    ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
};

/** Max file sizes per purpose (bytes). Enforced via presigned URL conditions. */
const MAX_SIZES: Record<UploadPurpose, number> = {
  avatar:    2 * 1024 * 1024,   //  2 MB
  portfolio: 10 * 1024 * 1024,  // 10 MB
  document:  5 * 1024 * 1024,   //  5 MB
  report:    10 * 1024 * 1024,  // 10 MB
};

const presignedUploadSchema = z.object({
  body: z.object({
    filename: z
      .string({ required_error: 'filename is required' })
      .min(1)
      .max(255)
      // Strip path traversal attempts.
      .refine((f) => !f.includes('/') && !f.includes('..'), {
        message: 'filename must not contain path separators',
      }),

    contentType: z
      .string({ required_error: 'contentType is required' })
      .min(1)
      .max(100),

    purpose: z.enum(ALLOWED_PURPOSES, {
      required_error: 'purpose is required',
      invalid_type_error: `purpose must be one of: ${ALLOWED_PURPOSES.join(', ')}`,
    }),
  }),
});

// ─── Controller ───────────────────────────────────────────────────────────────

/**
 * POST /api/upload/presigned
 *
 * Returns a short-lived (5 min) S3 presigned PUT URL the client uses to upload
 * directly to S3, plus the final public URL of the file after upload.
 *
 * Auth: bearer — any authenticated user
 */
async function getPresignedUrl(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { filename, contentType, purpose } = req.body as {
      filename: string;
      contentType: string;
      purpose: UploadPurpose;
    };
    const userId = req.user!.id;

    // Validate that the MIME type is allowed for this purpose.
    const allowedMimes = ALLOWED_MIME_TYPES[purpose];
    if (!allowedMimes.includes(contentType)) {
      sendError(
        res, 400, 'VALIDATION_ERROR',
        `contentType '${contentType}' is not allowed for purpose '${purpose}'. ` +
        `Allowed: ${allowedMimes.join(', ')}`,
      );
      return;
    }

    // Build a deterministic but unique S3 key to avoid collisions.
    // Format: {purpose-prefix}/{userId}/{timestamp}-{sanitised-filename}
    const sanitisedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const timestamp = Date.now();
    const purposePrefix: Record<UploadPurpose, string> = {
      avatar:    'avatars',
      portfolio: 'portfolio',
      document:  'kyc-documents',
      report:    'service-reports',
    };
    const fileKey = `${purposePrefix[purpose]}/${userId}/${timestamp}-${sanitisedFilename}`;

    const { uploadUrl, fileUrl } = await generatePresignedUploadUrl({
      fileKey,
      contentType,
      maxSizeBytes: MAX_SIZES[purpose],
      expiresInSeconds: 300, // 5 minutes
    });

    logger.info('Presigned URL generated', { userId, purpose, fileKey });

    sendSuccess(res, 200, { uploadUrl, fileKey, fileUrl });
  } catch (err) {
    next(err);
  }
}

// ─── Route Registration ───────────────────────────────────────────────────────

/**
 * All upload routes require authentication — we must know WHO is uploading
 * so the fileKey is namespaced under their userId.
 */
router.use(auth);

/**
 * POST /api/upload/presigned
 *
 * Body: { filename, contentType, purpose }
 * Response: { uploadUrl, fileKey, fileUrl }
 */
router.post(
  '/presigned',
  validate(presignedUploadSchema),
  getPresignedUrl,
);

export default router;
