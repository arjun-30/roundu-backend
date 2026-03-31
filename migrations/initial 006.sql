-- Migration 006 - TODO
-- Migration: 006_payments
-- Owner: Dev 1 (Wallet + Stripe + Cashback)
-- Tracks every Stripe payment intent tied to a booking.

CREATE TYPE payment_status AS ENUM ('pending', 'succeeded', 'failed', 'refunded');

CREATE TABLE payments (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id                UUID          NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id                   UUID          NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  stripe_payment_intent_id  VARCHAR(255)  UNIQUE,
  amount                    NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  currency                  VARCHAR(10)   NOT NULL DEFAULT 'inr',
  status                    payment_status NOT NULL DEFAULT 'pending',
  paid_at                   TIMESTAMPTZ,
  refunded_at               TIMESTAMPTZ,
  refund_amount             NUMERIC(10,2),
  metadata                  JSONB         NOT NULL DEFAULT '{}',
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_booking_id   ON payments(booking_id);
CREATE INDEX idx_payments_user_id      ON payments(user_id);
CREATE INDEX idx_payments_status       ON payments(status);
CREATE INDEX idx_payments_stripe_pi    ON payments(stripe_payment_intent_id);
CREATE INDEX idx_payments_created_at   ON payments(created_at DESC);
