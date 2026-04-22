-- Migration 018 - TODO
CREATE TABLE user_preferences (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID UNIQUE REFERENCES users(id) NOT NULL,
  interested_services UUID[] DEFAULT '{}',
  property_type       VARCHAR(30),
  rooms               VARCHAR(10),
  vehicles            TEXT[] DEFAULT '{}',
  ac_units            INT DEFAULT 0,
  budget_tier         VARCHAR(20) DEFAULT 'mid' CHECK (budget_tier IN ('budget', 'mid', 'premium')),
  preferred_timings   TEXT[] DEFAULT '{}',
  service_frequency   JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
