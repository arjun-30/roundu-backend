-- Migration 007 - TODO
CREATE TABLE ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID UNIQUE REFERENCES bookings(id) NOT NULL,
  customer_id UUID REFERENCES users(id) NOT NULL,
  provider_id UUID REFERENCES providers(id) NOT NULL,
  score       INT NOT NULL CHECK (score >= 1 AND score <= 5),
  review      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ratings_provider ON ratings(provider_id);
