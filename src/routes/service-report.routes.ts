// DEV 3
// src/routes/service-report.routes.ts
// Manages post-service reports filed by providers after completing a booking.
//
// Endpoints:
//   POST /api/service-reports              — submit service report (provider)
//   GET  /api/service-reports/:bookingId   — get report for a booking (bearer)
//
// Business rules enforced here:
//   - Only the provider assigned to the booking can submit a report.
//   - The booking must be in 'completed' status.
//   - One report per booking (returns 409 on duplicate).
//   - The requesting user must own the booking OR be the provider to fetch it.
//
// API Contract ref: §17 Service Reports

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import {
  createServiceReport,
  findReportByBookingId,
  reportExistsForBooking,
} from '../models/service-report.model';
import { findProviderByUserId } from '../models/provider.model';
import { db } from '../config/database';
import { sendSuccess, sendError } from '../utils/response';
import { logger } from '../utils/logger';

const router = Router();

// ─── Validation Schemas ───────────────────────────────────────────────────────

const createReportSchema = z.object({
  body: z.object({
    bookingId: z
      .string({ required_error: 'bookingId is required' })
      .uuid('bookingId must be a valid UUID'),

    workDone: z
      .string({ required_error: 'workDone is required' })
      .min(10, 'workDone description must be at least 10 characters')
      .max(2000, 'workDone description must be 2000 characters or less'),

    materials: z
      .array(
        z.object({
          name:     z.string().min(1).max(100),
          quantity: z.number().positive(),
          unit:     z.string().min(1).max(30),
          cost:     z.number().int().positive().optional(), // paise
        }),
      )
      .max(50, 'Maximum 50 materials allowed')
      .optional()
      .default([]),

    photos: z
      .array(
        z.string().url('Each photo must be a valid S3 URL'),
      )
      .max(10, 'Maximum 10 photos allowed per report')
      .optional()
      .default([]),

    notes: z
      .string()
      .max(500, 'notes must be 500 characters or less')
      .optional(),
  }),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve req.user.id → provider profile (throws if not found).
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
 * Fetch a booking row with minimal fields needed for the guards below.
 */
async function fetchBooking(bookingId: string) {
  const { rows } = await db.query(
    `SELECT id, user_id, provider_id, status
     FROM bookings WHERE id = $1`,
    [bookingId],
  );
  return rows[0] ?? null;
}

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * POST /api/service-reports
 *
 * Submit a service report after completing a booking.
 * Auth: provider
 *
 * Guards (checked in order):
 *   1. Provider profile exists for the authenticated user.
 *   2. Booking exists.
 *   3. The provider is the one assigned to this booking.
 *   4. Booking status is 'completed'.
 *   5. No report already exists (→ 409).
 */
async function submitReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const provider = await resolveProvider(req.user!.id);

    const { bookingId, workDone, materials, photos, notes } = req.body as {
      bookingId: string;
      workDone: string;
      materials: Array<{ name: string; quantity: number; unit: string; cost?: number }>;
      photos: string[];
      notes?: string;
    };

    // Guard 2: booking must exist.
    const booking = await fetchBooking(bookingId);
    if (!booking) {
      sendError(res, 404, 'NOT_FOUND', 'Booking not found');
      return;
    }

    // Guard 3: only the assigned provider can file a report.
    if (booking.provider_id !== provider.id) {
      sendError(
        res, 403, 'FORBIDDEN',
        'You can only submit reports for bookings assigned to you',
      );
      return;
    }

    // Guard 4: booking must be completed.
    if (booking.status !== 'completed') {
      sendError(
        res, 422, 'UNPROCESSABLE',
        `Cannot submit a report for a booking with status '${booking.status}'. ` +
        'Booking must be completed first.',
      );
      return;
    }

    // Guard 5: one report per booking.
    const exists = await reportExistsForBooking(bookingId);
    if (exists) {
      sendError(res, 409, 'CONFLICT', 'A report has already been submitted for this booking');
      return;
    }

    const report = await createServiceReport({
      booking_id: bookingId,
      provider_id: provider.id,
      work_done: workDone,
      materials,
      photos,
      notes,
    });

    logger.info('Service report submitted', {
      reportId: report.id,
      bookingId,
      providerId: provider.id,
    });

    sendSuccess(res, 201, report, undefined, 'Service report submitted successfully');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/service-reports/:bookingId
 *
 * Get the service report for a specific booking.
 * Auth: bearer — accessible by the booking's user OR the assigned provider.
 *
 * Access control:
 *   - The user who made the booking can read the report.
 *   - The provider assigned to the booking can also read it.
 *   - Anyone else gets 403.
 */
async function getReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { bookingId } = req.params;
    const requestingUserId = req.user!.id;

    // Fetch booking to check access rights.
    const booking = await fetchBooking(bookingId);
    if (!booking) {
      sendError(res, 404, 'NOT_FOUND', 'Booking not found');
      return;
    }

    // Check if requesting user is the booking's customer.
    const isBookingOwner = booking.user_id === requestingUserId;

    // Check if requesting user is the assigned provider.
    let isAssignedProvider = false;
    if (!isBookingOwner) {
      const provider = await findProviderByUserId(requestingUserId);
      isAssignedProvider = provider?.id === booking.provider_id;
    }

    if (!isBookingOwner && !isAssignedProvider) {
      sendError(res, 403, 'FORBIDDEN', 'You do not have access to this report');
      return;
    }

    const report = await findReportByBookingId(bookingId);
    if (!report) {
      sendError(res, 404, 'NOT_FOUND', 'No service report found for this booking');
      return;
    }

    sendSuccess(res, 200, report);
  } catch (err) {
    next(err);
  }
}

// ─── Route Registration ───────────────────────────────────────────────────────

/**
 * POST /api/service-reports
 * Provider only — files the post-job report.
 */
router.post(
  '/',
  auth,
  requireRole('provider'),
  validate(createReportSchema),
  submitReport,
);

/**
 * GET /api/service-reports/:bookingId
 * Any authenticated user — access controlled in the controller.
 */
router.get(
  '/:bookingId',
  auth,
  getReport,
);

export default router;
