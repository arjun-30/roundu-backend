-- Migration: 026.sql
-- Owner: Dev 4

-- Tracking sessions table
CREATE TABLE IF NOT EXISTS tracking_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          VARCHAR(16) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'ended')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  last_lat        NUMERIC(10, 7),
  last_lng        NUMERIC(10, 7),
  last_updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_booking   ON tracking_sessions(booking_id);
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_provider  ON tracking_sessions(provider_id);
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_status    ON tracking_sessions(status);

-- Individual GPS location points per session
CREATE TABLE IF NOT EXISTS tracking_locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  lat         NUMERIC(10, 7) NOT NULL,
  lng         NUMERIC(10, 7) NOT NULL,
  accuracy    NUMERIC(8, 2),              -- metres
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracking_locations_session ON tracking_locations(session_id);
CREATE INDEX IF NOT EXISTS idx_tracking_locations_time    ON tracking_locations(recorded_at);