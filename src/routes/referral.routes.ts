// Owner: Dev 4 — Referrals + Offers + Portfolio + Tracking
// Routes: referral.routes.ts

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { applyReferralSchema } from '../validators/referral.validator';
import { getMyCode, applyCode, getHistory } from '../controllers/referral.controller';

const router = Router();

// All referral routes require a logged-in user
router.use(authenticate);

// GET  /api/referrals/my-code
router.get('/my-code', getMyCode);

// POST /api/referrals/apply
router.post('/apply', validate(applyReferralSchema), applyCode);

// GET  /api/referrals/history
router.get('/history', getHistory);

export default router;