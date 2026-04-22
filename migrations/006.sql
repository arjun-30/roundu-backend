CREATE TABLE payments (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id               UUID REFERENCES bookings(id) NOT NULL,
  stripe_payment_intent_id VARCHAR(255) UNIQUE,
  stripe_customer_id       VARCHAR(255),
  amount                   INT NOT NULL,
  currency                 VARCHAR(5) DEFAULT 'INR',
  status                   VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','refunded','partial_refund')),
  refund_amount            INT,
  refund_reason            TEXT,
  method                   VARCHAR(20),
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_booking ON payments(booking_id);
CREATE INDEX idx_payments_intent ON payments(stripe_payment_intent_id);
