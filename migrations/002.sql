-- Migration: 002_users.sql
-- Owner: Tech Lead
-- Creates the core users table.
-- The auth controller (auth.controller.ts) already queries:
--   id, phone, name, email, role, avatar, is_blocked, created_at
-- This migration must match those column names exactly.

-- Enable pgcrypto for gen_random_uuid() if not already active
-- (001_extensions.sql should run first and enable uuid-ossp / pgcrypto)

CREATE TABLE IF NOT EXISTS users (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  phone        VARCHAR(20) NOT NULL UNIQUE,
  name         VARCHAR(100) NOT NULL,
  email        VARCHAR(255),             -- optional, set on profile update
  avatar       TEXT,                     -- S3 URL, set after upload

  -- Role-based access
  role         VARCHAR(20) NOT NULL DEFAULT 'user'
                 CHECK (role IN ('user', 'provider', 'admin')),

  -- Account state
  is_blocked   BOOLEAN     NOT NULL DEFAULT FALSE,
  deleted_at   TIMESTAMPTZ,              -- soft-delete; NULL = active

  -- Timestamps
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by phone (login, register duplicate-check)
CREATE INDEX IF NOT EXISTS idx_users_phone     ON users (phone);

-- Filter by role (admin list endpoint uses ?role=)
CREATE INDEX IF NOT EXISTS idx_users_role      ON users (role);

-- Soft-delete filter — most queries add WHERE deleted_at IS NULL
CREATE INDEX IF NOT EXISTS idx_users_active    ON users (deleted_at)
  WHERE deleted_at IS NULL;

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── User preferences (kept in its own table for clean separation) ──────────
-- Migration 018_user_preferences.sql will create the full preferences table.
-- We create a minimal version here so the user controller can use it from day 1.

CREATE TABLE IF NOT EXISTS user_preferences (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  notifications   BOOLEAN     NOT NULL DEFAULT TRUE,
  language        VARCHAR(10) NOT NULL DEFAULT 'en',

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prefs_user_id ON user_preferences (user_id);

DROP TRIGGER IF EXISTS trg_prefs_updated_at ON user_preferences;
CREATE TRIGGER trg_prefs_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
