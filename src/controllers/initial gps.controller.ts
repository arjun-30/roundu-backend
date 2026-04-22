// DEV 3 — logLocation(bulk), getAlerts, acknowledgeAlert, getGpsHistory(admin)
// src/controllers/gps.controller.ts
// Owner: Dev 3 (GPS + AI)
//
// Handles:
//   GET  /api/gps/logs/:bookingId       → fetch GPS history for a booking
//   GET  /api/gps/alerts                → provider's own GPS alerts
//   PATCH /api/gps/alerts/:id/resolve   → resolve a GPS alert

import { Request, Response, NextFunction } from 'express';
import { GpsLogModel } from '../models/gps-log.model';
import { GpsAlertModel } from '../models/gps-alert.model';
import { pool } from '../config/database';
import { sendSuccess } from '../utils/response';
import {
  gpsLogsParamSchema,
  gpsAlertsQuerySchema,
  gpsAlertResolveParamSchema,
} from '../validators/gps.validator';

const gpsLogModel = new GpsLogModel(pool);
const gpsAlertModel = new GpsAlertModel(pool);

// ─── GET /api/gps/logs/:bookingId ─────────────────────────────────────────────

/**
 * Returns the full GPS trail for a booking.
 * Accessible by the booking's customer or provider (auth middleware handles identity;
 * the booking ownership check is implicit — any bearer with a valid token who
 * knows the bookingId can query, which mirrors the API contract's `bearer` auth level).
 *
 * For stricter access control, extend with an ownership sub-query (see tracking.service.ts).
 */
export async function getGpsLogs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { bookingId } = gpsLogsParamSchema.parse(req.params);
    const logs = await gpsLogModel.findByBooking(bookingId);
    sendSuccess(res, logs, 'GPS logs retrieved');
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/gps/alerts ──────────────────────────────────────────────────────

/**
 * Returns all GPS alerts for the authenticated provider.
 * Optional ?resolved=true|false filter.
 */
export async function getGpsAlerts(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { resolved } = gpsAlertsQuerySchema.parse(req.query);
    // req.user is populated by the auth middleware
    const providerId = (req as any).user.id;
    const alerts = await gpsAlertModel.findByProvider(providerId, resolved);
    sendSuccess(res, alerts, 'GPS alerts retrieved');
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/gps/alerts/:id/resolve ────────────────────────────────────────

/**
 * Marks a specific GPS alert as resolved.
 * Only the provider who owns the alert can resolve it (enforced via providerId filter in model).
 */
export async function resolveGpsAlert(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = gpsAlertResolveParamSchema.parse(req.params);
    const providerId = (req as any).user.id;

    const updated = await gpsAlertModel.resolve(id, providerId);
    if (!updated) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Alert not found', details: {} },
      });
      return;
    }

    sendSuccess(res, updated, 'Alert resolved');
  } catch (err) {
    next(err);
  }
}
