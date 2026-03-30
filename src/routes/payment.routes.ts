// DEV 1 — Payment routes

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createPaymentIntentSchema } from '../validators/payment.validator';
import {
  createPaymentIntent,
  getPaymentHistory,
  getPaymentByBookingId,
} from '../controllers/payment.controller';

const router = Router();

// All payment routes require authentication
router.use(authenticate);

/**
 * POST /api/payments/intent
 * Create a Stripe PaymentIntent for a booking.
 * Body: { bookingId: uuid, useWalletBalance?: boolean }
 */
router.post(
  '/intent',
  validate({ body: createPaymentIntentSchema }),
  createPaymentIntent
);

/**
 * GET /api/payments/history
 * Paginated payment history for the logged-in user.
 */
router.get('/history', getPaymentHistory);

/**
 * GET /api/payments/:bookingId
 * Get payment record for a specific booking.
 */
router.get('/:bookingId', getPaymentByBookingId);

export default router;
