-- MigrationCREATE TABLE subscription_plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  price       NUMERIC(10,2) NOT NULL,
  currency    VARCHAR(3)   NOT NULL DEFAULT 'INR',
  interval    VARCHAR(20)  NOT NULL CHECK (interval IN ('monthly','yearly')),
  features    JSONB        NOT NULL DEFAULT '[]',
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  stripe_price_id VARCHAR(100),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
); 016 - TODO
