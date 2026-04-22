// DEV 3
// src/validators/gps.validator.ts
// Owner: Dev 3 (GPS + AI)
// Zod schemas for all /api/gps endpoints.

import { z } from 'zod';

/**
 * GET /api/gps/logs/:bookingId
 * No body — bookingId validated as a path param UUID.
 */
export const gpsLogsParamSchema = z.object({
  bookingId: z.string().uuid('bookingId must be a valid UUID'),
});

/**
 * GET /api/gps/alerts
 * Optional `resolved` query param.
 */
export const gpsAlertsQuerySchema = z.object({
  resolved: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

/**
 * PATCH /api/gps/alerts/:id/resolve
 * No body — alertId validated as a path param UUID.
 */
export const gpsAlertResolveParamSchema = z.object({
  id: z.string().uuid('Alert id must be a valid UUID'),
});
