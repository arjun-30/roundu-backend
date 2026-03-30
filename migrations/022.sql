-- Migration 022 - TODO-- Migration: 022_gps_alerts
-- Owner: Dev 3 (GPS + AI)
-- Stores geofence / deviation alerts raised by the GPS monitor service.

CREATE TYPE gps_alert_type AS ENUM (
  'route_deviation',      -- provider strayed significantly from expected route
  'geofence_exit',        -- provider left the job-site geofence before completion
  'long_idle',            -- provider stationary for too long mid-job
  'speed_anomaly'         -- unusually high speed detected (likely GPS noise)
);

CREATE TABLE gps_alerts (
  id           UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   UUID            NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider_id  UUID            NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  session_id   UUID            NOT NULL,
  alert_type   gps_alert_type  NOT NULL,
  detail       JSONB           NOT NULL DEFAULT '{}',  -- extra context: { deviation_meters, idle_seconds, etc. }
  resolved     BOOLEAN         NOT NULL DEFAULT FALSE,
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gps_alerts_provider_resolved ON gps_alerts (provider_id, resolved);
CREATE INDEX idx_gps_alerts_booking           ON gps_alerts (booking_id);

COMMENT ON TABLE  gps_alerts IS 'Geofence and behaviour alerts raised during provider GPS tracking.';
COMMENT ON COLUMN gps_alerts.detail IS 'Free-form JSONB for type-specific alert metadata.';
