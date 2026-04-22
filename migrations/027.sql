CREATE TABLE predictions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID REFERENCES users(id) NOT NULL,
  service_id         UUID REFERENCES services(id),
  predicted_issue    TEXT NOT NULL,
  predicted_date     DATE,
  urgency            VARCHAR(10) CHECK (urgency IN ('low', 'medium', 'high')),
  estimated_minutes  INT,
  source_report_id   UUID REFERENCES service_reports(id),
  is_notified        BOOLEAN DEFAULT false,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_predictions_customer ON predictions(customer_id);
CREATE INDEX idx_predictions_upcoming ON predictions(predicted_date) WHERE is_notified = false;
