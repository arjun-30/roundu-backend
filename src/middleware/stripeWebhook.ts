// TECH LEAD — Raw body parser for Stripe webhook
//
// Stripe signature verification requires the raw (un-parsed) request body.
// This middleware captures it as a Buffer and attaches it to req.rawBody
// BEFORE Express's json() parser runs.
//
// Wire up order in app.ts:
//   router.post('/payments/webhook', rawBodyParser, webhookController.handle)
//   ... (all other routes get the normal json() parser)

import { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

/**
 * Reads the entire request body as a raw Buffer and stores it on `req.rawBody`.
 * Must be applied BEFORE express.json() on the webhook route.
 *
 * Usage in webhook route:
 *   router.post('/webhook', rawBodyParser, handleStripeWebhook);
 */
export function rawBodyParser(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const chunks: Buffer[] = [];

  req.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  req.on('end', () => {
    req.rawBody = Buffer.concat(chunks);
    next();
  });

  req.on('error', (err) => {
    next(err);
  });
}﻿// TECH LEAD — Raw body parser for Stripe webhook
