// DEV 3
// src/routes/gps.routes.ts
// Owner: Dev 3 (GPS + AI)
//
// Mounts at: /api/gps
//
// GET  /api/gps/logs/:bookingId       bearer  → GPS history for a booking
// GET  /api/gps/alerts                provider → provider's own alerts
// PATCH /api/gps/alerts/:id/resolve   provider → resolve a specific alert

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { getGpsLogs, getGpsAlerts, resolveGpsAlert } from '../controllers/gps.controller';

const router = Router();

// Any authenticated user (customer or provider) can view GPS logs for a booking
router.get('/logs/:bookingId', authenticate, getGpsLogs);

// Only providers see and manage their own alerts
router.get('/alerts', authenticate, requireRole('provider'), getGpsAlerts);
router.patch('/alerts/:id/resolve', authenticate, requireRole('provider'), resolveGpsAlert);

export default router;
