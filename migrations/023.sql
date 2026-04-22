CREATE TABLE recommendations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) NOT NULL,
  service_id   UUID REFERENCES services(id) NOT NULL,
  service_name VARCHAR(100) NOT NULL,
  reason       TEXT NOT NULL,
  score        DECIMAL(4,2) DEFAULT 0,
  source       VARCHAR(20) DEFAULT 'rules' CHECK (source IN ('vllm', 'rules')),
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_recommendations_user ON recommendations(user_id);
