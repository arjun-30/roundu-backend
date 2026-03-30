// Owner: Dev 4 — Referrals + Offers + Portfolio + Tracking
// Model: tracking-session.model.ts
// Mirrors migration: 026_tracking_sessions.sql

export interface TrackingSession {
  id: string;             // sessionId
  bookingId: string;
  providerId: string;
  status: TrackingStatus;
  startedAt: Date;
  endedAt?: Date;
  lastLat?: number;
  lastLng?: number;
  lastUpdatedAt?: Date;
}

export type TrackingStatus = 'active' | 'ended';

export interface LocationPoint {
  sessionId: string;
  lat: number;
  lng: number;
  accuracy?: number;
  recordedAt: Date;
}

export interface SessionSummary {
  sessionId: string;
  bookingId: string;
  startedAt: Date;
  endedAt: Date;
  totalPoints: number;
  durationMinutes: number;
}