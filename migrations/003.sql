-- Migration 003 - TODO
CREATE TABLE services (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  slug        VARCHAR(100) UNIQUE NOT NULL,
  category    VARCHAR(50)  NOT NULL,
  description TEXT,
  icon_name   VARCHAR(50),
  is_active   BOOLEAN DEFAULT true,
  sort_order  INT     DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_services_category ON services(category);
CREATE INDEX idx_services_active ON services(is_active);
