// DEV 3
// src/routes/kyc.routes.ts
// Manages the provider KYC (Know Your Customer) verification flow via DigiLocker.
//
// Endpoints:
//   POST /api/kyc/initiate    — start KYC, get DigiLocker redirect URL (provider)
//   GET  /api/kyc/status      — check verification status (provider)
//   POST /api/kyc/callback    — DigiLocker webhook — INTERNAL (digilocker-sig)
//   GET  /api/kyc/documents   — list submitted KYC documents (provider)
//
// KYC Flow:
//   1. Provider calls POST /api/kyc/initiate
//      → Backend calls DigiLocker API to create a session
//      → Returns { redirectUrl } — provider opens this in a browser/webview
//   2. Provider completes Aadhaar/PAN verification on DigiLocker
//   3. DigiLocker calls POST /api/kyc/callback with the verification result
//      → Signature is verified (digilocker-sig middleware)
//      → Document records are created, provider.is_verified is updated
//   4. Provider can check GET /api/kyc/status at any time
//
// IMPORTANT — webhook route:
//   POST /api/kyc/callback must be mounted with raw body parsing
//   (same pattern as Stripe webhooks) so the HMAC signature can be verified.
//   Mount this router BEFORE express.json() in app.ts, or use the
//   rawBodyMiddleware on this specific path.
//
// API Contract ref: §12 KYC

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { auth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import {
  findDocumentsByProviderId,
  createDocument,
  updateDocumentStatus,
  areRequiredDocumentsVerified,
} from '../models/document.model';
import { findProviderByUserId, updateProvider } from '../models/provider.model';
import { initiateKycSession, fetchDigiLockerDocuments } from '../services/kyc.service';
import { db } from '../config/database';
import { env } from '../config/env';
import { sendSuccess, sendError } from '../utils/response';
import { logger } from '../utils/logger';

const router = Router();

// ─── Validation Schemas ───────────────────────────────────────────────────────

const initiateKycSchema = z.object({
  body: z.object({
    // Optional pre-fill values sent to DigiLocker's form.
    aadhaarNumber: z
      .string()
      .regex(/^\d{12}$/, 'aadhaarNumber must be exactly 12 digits')
      .optional(),

    panNumber: z
      .string()
      .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'panNumber must be a valid PAN format (e.g. ABCDE1234F)')
      .optional(),
  }),
});

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * verifyDigiLockerSignature
 *
 * DigiLocker signs its webhook payloads with an HMAC-SHA256 of the raw body
 * using the shared webhook secret. We verify this before processing any callback.
 *
 * The signature is delivered in the 'x-digilocker-signature' header as a
 * hex-encoded string.
 *
 * IMPORTANT: This middleware must run BEFORE express.json() parses the body.
 * The router for /api/kyc/callback is mounted in app.ts with raw body parsing.
 */
function verifyDigiLockerSignature(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const signature = req.headers['x-digilocker-signature'] as string | undefined;
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

  if (!env.DIGILOCKER_WEBHOOK_SECRET) {
    logger.error('DIGILOCKER_WEBHOOK_SECRET is not configured');
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Webhook secret not configured' },
    });
    return;
  }

  if (!signature || !rawBody) {
    res.status(400).json({
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message: 'Missing x-digilocker-signature header or request body',
      },
    });
    return;
  }

  // Compute expected HMAC.
  const expectedSig = crypto
    .createHmac('sha256', env.DIGILOCKER_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks.
  const sigBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSig, 'hex');

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    logger.warn('DigiLocker webhook signature verification failed');
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid webhook signature' },
    });
    return;
  }

  next();
}

/**
 * rawBodyCapture
 *
 * Captures the raw request body bytes before any JSON parser can consume them.
 * Mount on the callback route path specifically, BEFORE express.json().
 *
 * In app.ts:
 *   app.use('/api/kyc/callback', rawBodyCapture);
 *   app.use('/api/kyc', kycRouter);
 */
export function rawBodyCapture(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    (req as Request & { rawBody: Buffer }).rawBody = Buffer.concat(chunks);
    next();
  });
  req.on('error', () => {
    res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Failed to read request body' },
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve req.user.id → provider profile.
 * Returns null (doesn't throw) so callers can send custom error responses.
 */
async function resolveProvider(userId: string) {
  return findProviderByUserId(userId);
}

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * POST /api/kyc/initiate
 *
 * Start the KYC verification process.
 * Auth: provider
 *
 * Guards:
 *   - Provider must not already be verified (→ 409).
 *
 * Returns:
 *   { redirectUrl } — the DigiLocker consent URL for the provider to open.
 */
async function initiateKyc(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const provider = await resolveProvider(req.user!.id);
    if (!provider) {
      sendError(res, 404, 'NOT_FOUND', 'Provider profile not found');
      return;
    }

    // Guard: already verified.
    if (provider.is_verified) {
      sendError(res, 409, 'CONFLICT', 'KYC is already verified for this provider');
      return;
    }

    const { aadhaarNumber, panNumber } = req.body as {
      aadhaarNumber?: string;
      panNumber?: string;
    };

    // Create a KYC session via DigiLocker. This stores a session record
    // in kyc_verifications table and returns the redirect URL.
    const { redirectUrl, sessionId } = await initiateKycSession({
      providerId: provider.id,
      userId: req.user!.id,
      aadhaarNumber,
      panNumber,
    });

    logger.info('KYC session initiated', {
      providerId: provider.id,
      sessionId,
    });

    sendSuccess(res, 200, { redirectUrl });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/kyc/status
 *
 * Get the current KYC verification status for the authenticated provider.
 * Auth: provider
 *
 * Returns:
 *   { status: 'pending' | 'verified' | 'rejected', rejectionReason?: string }
 */
async function getKycStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const provider = await resolveProvider(req.user!.id);
    if (!provider) {
      sendError(res, 404, 'NOT_FOUND', 'Provider profile not found');
      return;
    }

    // Derive overall status from provider.is_verified and their document statuses.
    // Priority: if any doc is rejected → rejected
    //           if all required docs verified → verified
    //           otherwise → pending
    const { rows } = await db.query<{ status: string; rejection_reason: string | null }>(
      `SELECT status, rejection_reason
       FROM provider_documents
       WHERE provider_id = $1
       ORDER BY created_at DESC`,
      [provider.id],
    );

    let overallStatus: 'pending' | 'verified' | 'rejected' = 'pending';
    let rejectionReason: string | null = null;

    if (provider.is_verified) {
      overallStatus = 'verified';
    } else if (rows.some((r) => r.status === 'rejected')) {
      overallStatus = 'rejected';
      rejectionReason = rows.find((r) => r.status === 'rejected')?.rejection_reason ?? null;
    } else if (rows.length === 0) {
      overallStatus = 'pending'; // No documents submitted yet.
    }

    sendSuccess(res, 200, {
      status: overallStatus,
      ...(rejectionReason && { rejectionReason }),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/kyc/callback
 *
 * DigiLocker webhook — called by DigiLocker after the provider completes verification.
 * Auth: digilocker-sig (verifyDigiLockerSignature middleware)
 *
 * This is an INTERNAL endpoint — never called by the mobile app directly.
 *
 * Payload (from DigiLocker):
 *   {
 *     sessionId: string,
 *     status: 'SUCCESS' | 'FAILURE',
 *     documents: [{ type, fileUrl, fileKey, data }]
 *   }
 *
 * On SUCCESS:
 *   - Creates document records for each verified document.
 *   - Marks provider.is_verified = true if all required documents are present.
 *
 * On FAILURE:
 *   - Marks existing pending documents as rejected.
 */
async function handleDigiLockerCallback(
  req: Request,
  res: Response,
): Promise<void> {
  // Always acknowledge immediately — DigiLocker will retry on non-2xx.
  res.status(200).json({ received: true });

  try {
    // After rawBodyCapture, parse the JSON manually.
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    let payload: {
      sessionId: string;
      status: 'SUCCESS' | 'FAILURE';
      providerId?: string;
      documents?: Array<{
        type: string;
        fileUrl: string;
        fileKey: string;
        data?: Record<string, unknown>;
      }>;
      failureReason?: string;
    };

    try {
      payload = JSON.parse(rawBody?.toString() ?? '{}');
    } catch {
      logger.error('Failed to parse DigiLocker callback payload');
      return;
    }

    const { sessionId, status, documents = [], failureReason } = payload;

    // Look up the KYC session to get the providerId.
    const { rows: sessionRows } = await db.query(
      `SELECT provider_id FROM kyc_verifications WHERE session_id = $1 LIMIT 1`,
      [sessionId],
    );

    const kycSession = sessionRows[0];
    if (!kycSession) {
      logger.error('DigiLocker callback: unknown sessionId', { sessionId });
      return;
    }

    const providerId: string = kycSession.provider_id;

    if (status === 'SUCCESS') {
      // Create a document record for each verified document from DigiLocker.
      for (const doc of documents) {
        await createDocument({
          provider_id: providerId,
          document_type: doc.type as 'aadhaar' | 'pan' | 'driving_license' | 'passport' | 'other',
          file_url: doc.fileUrl,
          file_key: doc.fileKey,
          digilocker_data: doc.data,
        });
      }

      // Update document statuses to 'verified' for DigiLocker-sourced docs.
      await db.query(
        `UPDATE provider_documents
         SET status = 'verified', verified_at = now(), updated_at = now()
         WHERE provider_id = $1 AND status = 'pending'`,
        [providerId],
      );

      // Check if all required documents are now verified → mark provider as verified.
      const allVerified = await areRequiredDocumentsVerified(providerId);
      if (allVerified) {
        await updateProvider(providerId, { is_verified: true });
        logger.info('Provider KYC verified', { providerId });
      }

      // Update KYC session record.
      await db.query(
        `UPDATE kyc_verifications
         SET status = 'verified', completed_at = now(), updated_at = now()
         WHERE session_id = $1`,
        [sessionId],
      );
    } else {
      // Failure — mark session and any pending docs as rejected.
      await db.query(
        `UPDATE kyc_verifications
         SET status = 'rejected', failure_reason = $2, completed_at = now(), updated_at = now()
         WHERE session_id = $1`,
        [sessionId, failureReason ?? 'DigiLocker verification failed'],
      );

      await db.query(
        `UPDATE provider_documents
         SET
           status = 'rejected',
           rejection_reason = $2,
           updated_at = now()
         WHERE provider_id = $1 AND status = 'pending'`,
        [providerId, failureReason ?? 'Verification failed via DigiLocker'],
      );

      logger.warn('DigiLocker KYC failed', { providerId, sessionId, failureReason });
    }
  } catch (err) {
    logger.error('Error processing DigiLocker callback', { err });
  }
}

/**
 * GET /api/kyc/documents
 *
 * List all KYC documents submitted by the authenticated provider.
 * Auth: provider
 *
 * Returns document metadata — NOT the actual file contents.
 * File URLs are S3 presigned URLs so the client can view them.
 */
async function getKycDocuments(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const provider = await resolveProvider(req.user!.id);
    if (!provider) {
      sendError(res, 404, 'NOT_FOUND', 'Provider profile not found');
      return;
    }

    const documents = await findDocumentsByProviderId(provider.id);

    // Strip the internal file_key from the response — clients only need the URL.
    const sanitised = documents.map(({ file_key: _key, ...rest }) => rest);

    sendSuccess(res, 200, sanitised);
  } catch (err) {
    next(err);
  }
}

// ─── Route Registration ───────────────────────────────────────────────────────

/**
 * POST /api/kyc/initiate
 * Provider only — starts the DigiLocker verification flow.
 */
router.post(
  '/initiate',
  auth,
  requireRole('provider'),
  validate(initiateKycSchema),
  initiateKyc,
);

/**
 * GET /api/kyc/status
 * Provider only — returns current verification status.
 */
router.get(
  '/status',
  auth,
  requireRole('provider'),
  getKycStatus,
);

/**
 * POST /api/kyc/callback
 * Internal DigiLocker webhook.
 * verifyDigiLockerSignature guards this — NO auth middleware (not a user request).
 *
 * NOTE: rawBodyCapture must be applied at the app.ts level for this path
 * BEFORE express.json(), or the HMAC verification will fail.
 *
 * In app.ts:
 *   app.use('/api/kyc/callback', rawBodyCapture);
 *   app.use('/api/kyc', kycRouter);
 */
router.post(
  '/callback',
  verifyDigiLockerSignature,
  handleDigiLockerCallback,
);

/**
 * GET /api/kyc/documents
 * Provider only — list their submitted KYC documents.
 */
router.get(
  '/documents',
  auth,
  requireRole('provider'),
  getKycDocuments,
);

export default router;
