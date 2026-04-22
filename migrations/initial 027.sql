-- Migration 027 - TODO
-- Migration: 027_predictions
-- Owner: Dev 3 (GPS + AI)
--
-- Stores the AI engine's per-user prediction state.
-- One row per user per service — upserted on every engine run.
-- The push-notification job reads this table to find predictions due "soon"
-- and fires FCM notifications via the existing push-notification.job.ts.

CREATE TYPE prediction_status AS ENUM (
  'pending',      -- prediction made, notification not yet sent
  'notified',     -- FCM push sent to user
  'booked',       -- user actually booked after being notified (conversion)
  'expired'       -- predicted date passed with no booking
);

CREATE TABLE predictions (
  id                   UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID               NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id           UUID               NOT NULL REFERENCES services(id) ON DELETE CASCADE,

  -- Date on which the AI predicts the user will need this service again
  predicted_service_date DATE             NOT NULL,

  -- How many days before predicted_service_date to send the push notification
  notify_days_before   INTEGER            NOT NULL DEFAULT 3,

  -- Computed field: predicted_service_date - notify_days_before (when to fire FCM)
  notify_on_date       DATE               NOT NULL
    GENERATED ALWAYS AS (predicted_service_date - notify_days_before * INTERVAL '1 day') STORED,

  -- Raw reasoning from vLLM (stored for auditability / model improvement)
  ai_reasoning         TEXT,

  -- Confidence from vLLM (0–1)
  confidence           NUMERIC(4, 3)      NOT NULL DEFAULT 0.5,

  status               prediction_status  NOT NULL DEFAULT 'pending',
  notified_at          TIMESTAMPTZ,
  booked_at            TIMESTAMPTZ,

  -- Tracks which booking triggered the conversion (if any)
  converted_booking_id UUID               REFERENCES bookings(id),

  created_at           TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ        NOT NULL DEFAULT NOW(),

  -- One active prediction per user per service at a time
  UNIQUE (user_id, service_id)
);

-- Primary query for the notification job: find all pending predictions due today or earlier
CREATE INDEX idx_predictions_notify_on_date
  ON predictions (notify_on_date, status)
  WHERE status = 'pending';

-- Lookup by user for admin/debugging
CREATE INDEX idx_predictions_user
  ON predictions (user_id, status);

COMMENT ON TABLE  predictions IS 'Per-user AI predictions of when they will next need each service.';
COMMENT ON COLUMN predictions.notify_on_date IS 'Generated column: the calendar date on which FCM push should fire.';
COMMENT ON COLUMN predictions.status IS 'Lifecycle: pending → notified → booked|expired.';
