-- Migration 020 - TODO
CREATE TABLE service_reports (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id             UUID UNIQUE REFERENCES bookings(id) NOT NULL,
  provider_id            UUID REFERENCES providers(id) NOT NULL,
  root_cause             VARCHAR(200),
  severity               VARCHAR(20) CHECK (severity IN ('minor', 'moderate', 'severe', 'critical')),
  next_service_months    INT,
  related_issues         TEXT[] DEFAULT '{}',
  follow_up              TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_provider ON service_reports(provider_id);
