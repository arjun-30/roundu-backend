-- Migration 019 - TODO
CREATE TABLE provider_portfolios (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  UUID REFERENCES providers(id) NOT NULL,
  type         VARCHAR(20) NOT NULL CHECK (type IN ('video', 'before_after')),
  video_url    TEXT,
  before_url   TEXT,
  after_url    TEXT,
  description  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_portfolio_provider ON provider_portfolios(provider_id);
