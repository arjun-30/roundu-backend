// DEV 1 — Stripe webhook route (no auth middleware — validated via stripe-sig)

import { Router } from 'express';
import { stripeWebhookMiddleware } from '../middleware/stripeWebhook';
import { handleStripeWebhook } from '../controllers/webhook.controller';

const router = Router();

/**
 * POST /api/payments/webhook
 *
 * IMPORTANT: This route must receive the raw request body so Stripe can
 * verify the signature. stripeWebhookMiddleware applies express.raw()
 * before the JSON body parser runs on other routes.
 *
 * Mount this BEFORE the global express.json() middleware in app.ts.
 */
router.post(
  '/webhook',
  stripeWebhookMiddleware,   // parses raw body into req.body as Buffer
  handleStripeWebhook
);

export default router;
