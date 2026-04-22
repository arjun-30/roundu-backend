-- migrations/005_bookings.sql

CREATE TYPE booking_status AS ENUM (
  'pending',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled'
);

CREATE TABLE bookings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id      UUID REFERENCES providers(id) ON DELETE SET NULL,
  service_id       UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,

  -- Scheduling
  scheduled_at     TIMESTAMPTZ NOT NULL,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,

  -- Status
  status           booking_status NOT NULL DEFAULT 'pending',
  status_note      TEXT,

  -- Address (denormalised for historical accuracy)
  address_line1    TEXT NOT NULL,
  address_lat      NUMERIC(10, 7) NOT NULL,
  address_lng      NUMERIC(10, 7) NOT NULL,
  address_point    GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
                     ST_SetSRID(ST_MakePoint(address_lng, address_lat), 4326)
                   ) STORED,

  -- Pricing snapshot at booking time
  base_price       NUMERIC(10, 2) NOT NULL,
  discount_amount  NUMERIC(10, 2) NOT NULL DEFAULT 0,
  final_price      NUMERIC(10, 2) NOT NULL,
  currency         CHAR(3) NOT NULL DEFAULT 'INR',

  -- Offer / coupon applied
  offer_id         UUID REFERENCES offers(id) ON DELETE SET NULL,
  coupon_code      TEXT,

  -- Payment
  payment_status   TEXT NOT NULL DEFAULT 'unpaid'
                     CHECK (payment_status IN ('unpaid', 'paid', 'refunded', 'partial_refund')),
  payment_id       UUID REFERENCES payments(id) ON DELETE SET NULL,

  -- Cancellation
  cancelled_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at     TIMESTAMPTZ,
  cancel_reason    TEXT,
  refund_amount    NUMERIC(10, 2),

  -- Misc
  notes            TEXT,
  is_rated         BOOLEAN NOT NULL DEFAULT FALSE,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Most common list queries
CREATE INDEX idx_bookings_user_id        ON bookings(user_id);
CREATE INDEX idx_bookings_provider_id    ON bookings(provider_id);
CREATE INDEX idx_bookings_service_id     ON bookings(service_id);
CREATE INDEX idx_bookings_status         ON bookings(status);
CREATE INDEX idx_bookings_scheduled_at   ON bookings(scheduled_at);
CREATE INDEX idx_bookings_payment_status ON bookings(payment_status);

-- Admin date-range filter
CREATE INDEX idx_bookings_created_at     ON bookings(created_at);

-- PostGIS spatial index (provider matching radius queries)
CREATE INDEX idx_bookings_address_point  ON bookings USING GIST(address_point);

-- Composite: provider dashboard (status + date)
CREATE INDEX idx_bookings_provider_status
  ON bookings(provider_id, status, scheduled_at DESC);

-- Composite: user booking list (user + status)
CREATE INDEX idx_bookings_user_status
  ON bookings(user_id, status, scheduled_at DESC);

-- ── Auto-update updated_at ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Status transition audit log ───────────────────────────────────────────────

CREATE TABLE booking_status_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  from_status booking_status,
  to_status   booking_status NOT NULL,
  changed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_booking_status_logs_booking_id
  ON booking_status_logs(booking_id);