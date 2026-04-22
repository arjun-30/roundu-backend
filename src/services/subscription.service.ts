// Owner: Dev 2 — Subscriptions + Notifications
import { Op } from 'sequelize';
import Stripe from 'stripe';
import { Subscription, SubscriptionStatus } from '../models/subscription.model';
import { SubscriptionPlan } from '../models/subscription-plan.model';
import { stripe } from '../config/stripe';
import { Notify } from './notification.service';
import { AppError } from '../utils/response';

// ─── Plan helpers ─────────────────────────────────────────────────────────────

export async function listPlans(): Promise<SubscriptionPlan[]> {
  return SubscriptionPlan.findAll({ where: { isActive: true } });
}

// ─── Subscription CRUD ────────────────────────────────────────────────────────

export async function getActiveSubscription(userId: string): Promise<Subscription | null> {
  return Subscription.findOne({
    where: { userId, status: 'active' },
    include: [{ model: SubscriptionPlan, as: 'plan' }],
  });
}

export async function subscribe(
  userId: string,
  planId: string,
  paymentMethodId: string
): Promise<Subscription> {
  const existing = await getActiveSubscription(userId);
  if (existing) throw new AppError('CONFLICT', 'Already subscribed to an active plan', 409);

  const plan = await SubscriptionPlan.findByPk(planId);
  if (!plan || !plan.isActive) throw new AppError('NOT_FOUND', 'Plan not found', 404);
  if (!plan.stripePriceId) throw new AppError('UNPROCESSABLE', 'Plan not available for purchase', 422);

  // Retrieve or create Stripe customer for this user
  const { User } = await import('../models/user.model');
  const user = await User.findByPk(userId);
  if (!user) throw new AppError('NOT_FOUND', 'User not found', 404);

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      phone:    user.phone,
      name:     user.name,
      metadata: { userId },
    });
    customerId = customer.id;
    await user.update({ stripeCustomerId: customerId });
  }

  // Attach payment method + set as default
  await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  // Create Stripe subscription
  const stripeSub = await stripe.subscriptions.create({
    customer:          customerId,
    items:             [{ price: plan.stripePriceId }],
    payment_behavior:  'default_incomplete',
    expand:            ['latest_invoice.payment_intent'],
    metadata:          { userId, planId },
  });

  const sub = await Subscription.create({
    userId,
    planId,
    status:               'active',
    stripeSubscriptionId: stripeSub.id,
    currentPeriodStart:   new Date(stripeSub.current_period_start * 1000),
    currentPeriodEnd:     new Date(stripeSub.current_period_end   * 1000),
  });

  await Notify.subscriptionActivated(userId, plan.name, sub.currentPeriodEnd);

  return sub;
}

export async function cancelSubscription(userId: string): Promise<{ cancellationDate: Date }> {
  const sub = await getActiveSubscription(userId);
  if (!sub) throw new AppError('NOT_FOUND', 'No active subscription', 404);

  if (sub.stripeSubscriptionId) {
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  }

  await sub.update({ cancelAtPeriodEnd: true, cancelledAt: new Date() });

  return { cancellationDate: sub.currentPeriodEnd };
}

// ─── Feature gating ───────────────────────────────────────────────────────────

/**
 * Returns true when the user has an active subscription.
 * Extend this if plans have different feature tiers.
 */
export async function checkFeatureAccess(userId: string): Promise<boolean> {
  const sub = await getActiveSubscription(userId);
  return sub !== null;
}

// ─── Called by subscription-scheduler.job.ts ─────────────────────────────────

/** Mark subscriptions whose Stripe period has ended as expired */
export async function expireStaleSubscriptions(): Promise<number> {
  const [count] = await Subscription.update(
    { status: 'expired' },
    {
      where: {
        status:            'active',
        currentPeriodEnd:  { [Op.lt]: new Date() },
        cancelAtPeriodEnd: true,
      },
    }
  );
  return count;
}

/** Find subscriptions expiring within N days — used by expiry-warning job */
export async function getSubscriptionsExpiringIn(days: number): Promise<Subscription[]> {
  const from = new Date();
  const to   = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return Subscription.findAll({
    where: {
      status:           'active',
      currentPeriodEnd: { [Op.between]: [from, to] },
      cancelAtPeriodEnd: true,
    },
    include: [{ model: SubscriptionPlan, as: 'plan' }],
  });
}
