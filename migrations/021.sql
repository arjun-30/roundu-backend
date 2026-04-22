-- Migration: 021_gps_logs
-- Owner: Dev 3 (GPS + AI)
-- Stores every raw GPS ping from a provider during an active booking.
-- Uses PostGIS geography type for accurate distance queries.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE gps_logs (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       UUID          NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider_id      UUID          NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  session_id       UUID          NOT NULL,                        -- FK resolved after tracking_sessions is created
  location         GEOGRAPHY(Point, 4326) NOT NULL,               -- PostGIS point (lng, lat)
  accuracy_meters  NUMERIC(8, 2),
  recorded_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Fast lookup: all pings for a booking ordered by time (primary query path)
CREATE INDEX idx_gps_logs_booking_recorded  ON gps_logs (booking_id, recorded_at DESC);

-- Fast lookup: latest ping for a provider (used by live-tracking feed)
CREATE INDEX idx_gps_logs_provider_recorded ON gps_logs (provider_id, recorded_at DESC);

-- Spatial index for any geo-proximity queries
CREATE INDEX idx_gps_logs_location          ON gps_logs USING GIST (location);

COMMENT ON TABLE  gps_logs IS 'Raw GPS pings emitted by providers during active bookings.';
COMMENT ON COLUMN gps_logs.location IS 'PostGIS geography point stored as (longitude, latitude).';﻿-- Migration 021 - TODO
