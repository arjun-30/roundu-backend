// DEV 2
// Owner: Dev 2 — Subscriptions + Notifications
import request from 'supertest';
import app from '../../app';
import { SubscriptionPlan } from '../../models/subscription-plan.model';
import { Subscription } from '../../models/subscription.model';
import { Notification } from '../../models/notification.model';

// Mock Stripe so we don't hit the real API
jest.mock('../../config/stripe', () => ({
  stripe: {
    customers:        { create: jest.fn().mockResolvedValue({ id: 'cus_test' }), update: jest.fn() },
    paymentMethods:   { attach: jest.fn() },
    subscriptions:    {
      create: jest.fn().mockResolvedValue({
        id: 'sub_test',
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end:   Math.floor(Date.now() / 1000) + 30 * 86400,
      }),
      update: jest.fn(),
    },
  },
}));

// Mock FCM so we don't need Firebase credentials
jest.mock('../../services/fcm.service', () => ({
  sendToDevice: jest.fn().mockResolvedValue(undefined),
}));

let userToken: string;
let planId: string;

beforeAll(async () => {
  // Assumes test DB is seeded with a user and auth token helper
  userToken = await global.getTestUserToken();

  const plan = await SubscriptionPlan.create({
    name: 'Pro', price: 299, currency: 'INR', interval: 'monthly',
    features: ['priority_matching'], stripePriceId: 'price_test',
  });
  planId = plan.id;
});

afterAll(async () => {
  await Subscription.destroy({ where: {} });
  await SubscriptionPlan.destroy({ where: {} });
  await Notification.destroy({ where: {} });
});

describe('GET /api/subscriptions/plans', () => {
  it('returns plans without auth', async () => {
    const res = await request(app).get('/api/subscriptions/plans');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: planId })]));
  });
});

describe('POST /api/subscriptions/subscribe', () => {
  it('creates a subscription and sends a notification', async () => {
    const res = await request(app)
      .post('/api/subscriptions/subscribe')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ planId, paymentMethodId: 'pm_test_visa' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'active', planId });

    const notif = await Notification.findOne({ where: { type: 'subscription_activated' } });
    expect(notif).not.toBeNull();
  });

  it('returns 409 when already subscribed', async () => {
    const res = await request(app)
      .post('/api/subscriptions/subscribe')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ planId, paymentMethodId: 'pm_test_visa' });

    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/subscriptions/me', () => {
  it('cancels at period end', async () => {
    const res = await request(app)
      .delete('/api/subscriptions/me')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('cancellationDate');

    const sub = await Subscription.findOne({ where: { status: 'active' } });
    expect(sub?.cancelAtPeriodEnd).toBe(true);
  });
});
