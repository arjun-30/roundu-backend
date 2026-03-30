// Owner: Dev 4 — Referrals + Offers + Portfolio + Tracking
// Routes: tracking.routes.ts

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireProvider } from '../middleware/requireProvider';
import { validate } from '../middleware/validate';
import { startTrackingSchema, updateLocationSchema } from '../validators/tracking.validator';
import { start, updateLoc, get, end } from '../controllers/tracking.controller';

const router = Router();

// POST /api/tracking/start — provider only
router.post(
  '/start',
  authenticate,
  requireProvider,
  validate(startTrackingSchema),
  start,
);

// PATCH /api/tracking/:sessionId/location — provider only
router.patch(
  '/:sessionId/location',
  authenticate,
  requireProvider,
  validate(updateLocationSchema),
  updateLoc,
);

// GET /api/tracking/:sessionId — any authenticated user (user or provider)
router.get('/:sessionId', authenticate, get);

// POST /api/tracking/:sessionId/end — provider only
router.post('/:sessionId/end', authenticate, requireProvider, end);

export default router;