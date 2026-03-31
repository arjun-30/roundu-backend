-- Migration 025 - TODO
CREATE TABLE call_logs (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id                  UUID REFERENCES bookings(id) NOT NULL,
  phone                       VARCHAR(15) NOT NULL,
  role                        VARCHAR(10) NOT NULL CHECK (role IN ('customer', 'provider')),
  elevenlabs_conversation_id  VARCHAR(255),
  status                      VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'ringing', 'answered', 'completed', 'failed', 'no_answer')),
  duration_seconds            INT,
  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_call_logs_booking ON call_logs(booking_id);
