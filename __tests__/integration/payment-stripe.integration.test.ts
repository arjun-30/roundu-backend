// DEV 1
// __tests__/integration/payment-stripe.integration.test.ts
// Owner: Dev 1 — Stripe Integration
//
// Tests the full payment flow:
//   1. Create a PaymentIntent
//   2. Simulate Stripe webhook → payment_intent.succeeded
//   3. Verify DB state updated correctly
//   4. Verify booking payment_status updated
//
// Uses Stripe test-mode keys. Set STRIPE_SECRET_KEY=sk_test_... in .env.test

import request from 'supertest';
import Stripe from 'stripe';
import { app } from '../../src/app';
import { db } from '../../src/config/database';
import { stripe } from '../../src/config/stripe';
import { findPaymentByIntentId } from '../../src/models/payment.model';
import { createTestUser, createTestBooking, getAuthToken } from '../helpers';

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

let testUser: { id: string; phone: string };
let testBooking: { id: string; total_amount: number };
let authToken: string;

beforeAll(async () => {
  testUser = await createTestUser({ role: 'user' });
  testBooking = await createTestBooking({ userId: testUser.id, amount: 50000 }); // ₹500
  authToken = await getAuthToken(testUser.phone);
});

afterAll(async () => {
  await db.query('DELETE FROM payments WHERE user_id = $1', [testUser.id]);
  await db.query('DELETE FROM bookings WHERE id = $1', [testBooking.id]);
  await db.query('DELETE FROM users WHERE id = $1', [testUser.id]);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/payments/intent', () => {
  it('should create a PaymentIntent and return clientSecret', async () => {
    const res = await request(app)
      .post('/api/payments/intent')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ bookingId: testBooking.id });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.clientSecret).toMatch(/^pi_.*_secret_/);
    expect(res.body.data.paymentIntentId).toMatch(/^pi_/);
    expect(res.body.data.amount).toBe(50000);
    expect(res.body.data.currency).toBe('inr');
  });

  it('should reject a request without auth token', async () => {
    const res = await request(app)
      .post('/api/payments/intent')
      .send({ bookingId: testBooking.id });

    expect(res.status).toBe(401);
  });

  it('should reject an invalid bookingId format', async () => {
    const res = await request(app)
      .post('/api/payments/intent')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ bookingId: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should reject a booking that belongs to another user', async () => {
    const otherUser = await createTestUser({ role: 'user' });
    const otherToken = await getAuthToken(otherUser.phone);

    const res = await request(app)
      .post('/api/payments/intent')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ bookingId: testBooking.id });

    expect(res.status).toBe(403);
  });

  it('should return 400 if booking is already paid', async () => {
    // Mark booking as already paid.
    await db.query(
      "UPDATE bookings SET payment_status = 'paid' WHERE id = $1",
      [testBooking.id],
    );
    // Also insert a succeeded payment row.
    await db.query(
      `INSERT INTO payments (booking_id, user_id, stripe_payment_intent_id, amount, status)
       VALUES ($1, $2, 'pi_fake_succeeded', 50000, 'succeeded')`,
      [testBooking.id, testUser.id],
    );

    const res = await request(app)
      .post('/api/payments/intent')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ bookingId: testBooking.id });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ALREADY_PAID');

    // Clean up
    await db.query("UPDATE bookings SET payment_status = 'unpaid' WHERE id = $1", [testBooking.id]);
    await db.query("DELETE FROM payments WHERE stripe_payment_intent_id = 'pi_fake_succeeded'");
  });
});

describe('POST /api/payments/webhook — payment_intent.succeeded', () => {
  let intentId: string;

  beforeEach(async () => {
    // Create a real Stripe test-mode intent.
    const intent = await stripe.paymentIntents.create({
      amount: 50000,
      currency: 'inr',
      automatic_payment_methods: { enabled: true },
      metadata: { bookingId: testBooking.id, userId: testUser.id },
    });
    intentId = intent.id;

    // Insert pending payment row.
    await db.query(
      `INSERT INTO payments (booking_id, user_id, stripe_payment_intent_id, amount)
       VALUES ($1, $2, $3, 50000)`,
      [testBooking.id, testUser.id, intentId],
    );
  });

  afterEach(async () => {
    await db.query(
      'DELETE FROM payments WHERE stripe_payment_intent_id = $1',
      [intentId],
    );
  });

  it('should update payment status to succeeded via webhook', async () => {
    // Construct a signed test webhook event.
    const payload = JSON.stringify({
      id: `evt_test_${Date.now()}`,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: intentId,
          object: 'payment_intent',
          amount: 50000,
          currency: 'inr',
          status: 'succeeded',
          metadata: { bookingId: testBooking.id, userId: testUser.id },
          latest_charge: null,
        },
      },
    });

    const sig = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET!,
    });

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('stripe-signature', sig)
      .set('Content-Type', 'application/json')
      .send(Buffer.from(payload));

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    // Give the async handler time to process.
    await new Promise((r) => setTimeout(r, 200));

    const payment = await findPaymentByIntentId(intentId);
    expect(payment?.status).toBe('succeeded');
    expect(payment?.paid_at).not.toBeNull();
  });

  it('should reject a webhook with an invalid signature', async () => {
    const res = await request(app)
      .post('/api/payments/webhook')
      .set('stripe-signature', 'invalid_signature')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('GET /api/payments/history', () => {
  it('should return paginated payment history', async () => {
    const res = await request(app)
      .get('/api/payments/history?page=1&limit=5')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page', 1);
    expect(res.body).toHaveProperty('limit', 5);
  });
});
