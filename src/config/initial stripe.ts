// TECH LEAD — Stripe SDK init
// src/config/stripe.ts
// Owner: Dev 1 (Wallet + Stripe + Cashback)
//
// Initialises the Stripe Node SDK once and exports a singleton.
// Never import stripe directly elsewhere — always import from here.

import Stripe from 'stripe';
import { env } from './env';

if (!env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment variables');
}

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  // Pin to the API version used during development.
  // Upgrade deliberately — never auto-upgrade in production.
  apiVersion: '2024-06-20',
  typescript: true,
  maxNetworkRetries: 2,           // built-in idempotent retry on network errors
  telemetry: false,               // opt out of Stripe usage telemetry
});

// Webhook secret used by the stripeWebhook middleware to verify signatures.
export const STRIPE_WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
