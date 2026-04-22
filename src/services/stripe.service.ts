// DEV 1 — createPaymentIntent, confirmPayment, createRefund, constructWebhookEvent

import Stripe from 'stripe';

// Stripe client is initialised once and exported; the config/stripe.ts
// module owns the SDK init — we import from there in real code.
// Here we accept it via constructor so the service is testable.

export interface CreateIntentParams {
  amountPaise: number;       // Stripe uses smallest currency unit (paise for INR)
  currency?: string;
  bookingId: string;
  userId: string;
  customerId?: string;       // Stripe customer ID if already created
  paymentMethodId?: string;  // for one-step confirm
  metadata?: Record<string, string>;
}

export interface RefundParams {
  paymentIntentId: string;
  amountPaise?: number;      // partial refund if provided, else full
  reason?: Stripe.RefundCreateParams.Reason;
  metadata?: Record<string, string>;
}

export class StripeService {
  constructor(private stripe: Stripe) {}

  /**
   * Creates a PaymentIntent. The client SDK will confirm it on the frontend.
   */
  async createPaymentIntent(params: CreateIntentParams): Promise<Stripe.PaymentIntent> {
    return this.stripe.paymentIntents.create({
      amount: params.amountPaise,
      currency: params.currency ?? 'inr',
      payment_method: params.paymentMethodId,
      confirm: !!params.paymentMethodId,
      customer: params.customerId,
      metadata: {
        booking_id: params.bookingId,
        user_id: params.userId,
        ...params.metadata,
      },
      automatic_payment_methods: params.paymentMethodId
        ? undefined
        : { enabled: true },
    });
  }

  /**
   * Retrieves a PaymentIntent by ID.
   */
  async getPaymentIntent(intentId: string): Promise<Stripe.PaymentIntent> {
    return this.stripe.paymentIntents.retrieve(intentId);
  }

  /**
   * Confirms a PaymentIntent server-side (used when paymentMethodId is available).
   */
  async confirmPaymentIntent(
    intentId: string,
    paymentMethodId: string
  ): Promise<Stripe.PaymentIntent> {
    return this.stripe.paymentIntents.confirm(intentId, {
      payment_method: paymentMethodId,
    });
  }

  /**
   * Cancels a PaymentIntent (before capture). Only valid if status is
   * requires_payment_method | requires_capture | requires_confirmation | requires_action.
   */
  async cancelPaymentIntent(intentId: string): Promise<Stripe.PaymentIntent> {
    return this.stripe.paymentIntents.cancel(intentId);
  }

  /**
   * Issues a full or partial refund.
   */
  async createRefund(params: RefundParams): Promise<Stripe.Refund> {
    return this.stripe.refunds.create({
      payment_intent: params.paymentIntentId,
      amount: params.amountPaise,           // omit for full refund
      reason: params.reason ?? 'requested_by_customer',
      metadata: params.metadata,
    });
  }

  /**
   * Validates and constructs a Stripe webhook event from raw body + signature.
   * Throws StripeSignatureVerificationError on tampered payloads.
   */
  constructWebhookEvent(
    rawBody: Buffer | string,
    signature: string,
    webhookSecret: string
  ): Stripe.Event {
    return this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }

  /**
   * Creates or retrieves a Stripe Customer for a user.
   */
  async upsertCustomer(params: {
    userId: string;
    phone: string;
    name?: string;
    email?: string;
  }): Promise<Stripe.Customer> {
    // Search by metadata first to avoid duplicates
    const existing = await this.stripe.customers.search({
      query: `metadata['user_id']:'${params.userId}'`,
      limit: 1,
    });

    if (existing.data.length > 0) {
      return existing.data[0] as Stripe.Customer;
    }

    return this.stripe.customers.create({
      phone: params.phone,
      name: params.name,
      email: params.email,
      metadata: { user_id: params.userId },
    });
  }
}
