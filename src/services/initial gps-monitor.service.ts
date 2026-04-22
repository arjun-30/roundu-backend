// DEV 3 — analyzeProviderPresence, cross-ref GPS vs customer addresses
// src/services/gps-monitor.service.ts
// Owner: Dev 3 (GPS + AI)
//
// Responsibilities:
//   1. Route-deviation detection  — compare provider location vs Google Directions polyline
//   2. Geofence-exit detection    — provider leaves the customer's job-site radius
//   3. Long-idle detection        — provider hasn't moved beyond threshold for N minutes
//   4. Speed-anomaly detection    — computed speed between two pings is unrealistically high
//
// This service is called ONLY from gps-analysis.job.ts (BullMQ worker), never inline
// in the HTTP request path, so latency here does not affect the 200 OK to the provider.

import axios from 'axios';
import { Pool } from 'pg';
import { GpsLogModel, GpsLog } from '../models/gps-log.model';
import { GpsAlertModel, GpsAlertType } from '../models/gps-alert.model';
import { TrackingSessionModel } from '../models/tracking-session.model';
import { logger } from '../utils/logger';
import { socketEmitter } from '../socket/emitters';

// ─── Config constants ─────────────────────────────────────────────────────────

/** Maximum off-route distance (metres) before raising route_deviation alert */
const ROUTE_DEVIATION_THRESHOLD_M = 300;

/** Radius (metres) within which the provider must stay at the customer's address */
const GEOFENCE_RADIUS_M = 150;

/** Number of consecutive pings that must be inside the geofence before we monitor exit */
const GEOFENCE_LOCK_IN_PINGS = 3;

/** If provider hasn't moved more than this (metres) for IDLE_WINDOW_MINUTES, raise alert */
const IDLE_MOVEMENT_THRESHOLD_M = 30;
const IDLE_WINDOW_MINUTES = 10;

/** Any computed speed above this (km/h) is considered a GPS anomaly */
const MAX_REALISTIC_SPEED_KMH = 120;

// ─── Haversine helper ─────────────────────────────────────────────────────────

/**
 * Returns the great-circle distance in metres between two lat/lng points.
 */
function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// ─── Google Directions ETA helper ────────────────────────────────────────────

interface DirectionsResult {
  etaSeconds: number;
  etaDistanceMeters: number;
  polylinePoints: Array<{ lat: number; lng: number }>;
}

/**
 * Call Google Directions API and decode the overview polyline.
 * Returns ETA seconds, distance metres, and decoded polyline waypoints.
 */
async function fetchDirections(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<DirectionsResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    logger.warn('gps-monitor: GOOGLE_MAPS_API_KEY not set — skipping ETA fetch');
    return null;
  }

  try {
    const url = 'https://maps.googleapis.com/maps/api/directions/json';
    const { data } = await axios.get(url, {
      params: {
        origin: `${originLat},${originLng}`,
        destination: `${destLat},${destLng}`,
        mode: 'driving',
        key: apiKey,
      },
      timeout: 5000,
    });

    if (data.status !== 'OK' || !data.routes?.length) return null;

    const leg = data.routes[0].legs[0];
    const etaSeconds: number = leg.duration.value;
    const etaDistanceMeters: number = leg.distance.value;

    // Decode the encoded polyline string into lat/lng points
    const encodedPolyline: string = data.routes[0].overview_polyline.points;
    const polylinePoints = decodePolyline(encodedPolyline);

    return { etaSeconds, etaDistanceMeters, polylinePoints };
  } catch (err) {
    logger.error({ err }, 'gps-monitor: Google Directions API error');
    return null;
  }
}

/**
 * Decode a Google encoded polyline string into an array of { lat, lng } objects.
 * Algorithm: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dLat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dLng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/**
 * Returns the minimum distance (metres) from a point to any segment on a polyline.
 */
function minDistanceToPolyline(
  lat: number,
  lng: number,
  polyline: Array<{ lat: number; lng: number }>,
): number {
  if (!polyline.length) return Infinity;
  let min = Infinity;
  for (const point of polyline) {
    const d = haversineMeters(lat, lng, point.lat, point.lng);
    if (d < min) min = d;
  }
  return min;
}

// ─── GpsMonitorService ───────────────────────────────────────────────────────

export interface MonitorContext {
  sessionId: string;
  bookingId: string;
  providerId: string;
  currentLat: number;
  currentLng: number;
  /** Customer's service address */
  destinationLat: number;
  destinationLng: number;
}

export class GpsMonitorService {
  private readonly gpsLogModel: GpsLogModel;
  private readonly gpsAlertModel: GpsAlertModel;
  private readonly trackingSessionModel: TrackingSessionModel;

  constructor(db: Pool) {
    this.gpsLogModel = new GpsLogModel(db);
    this.gpsAlertModel = new GpsAlertModel(db);
    this.trackingSessionModel = new TrackingSessionModel(db);
  }

  /**
   * Main entry point called by gps-analysis.job.ts.
   * Runs all checks and emits socket events for any alerts raised.
   */
  async analyse(ctx: MonitorContext): Promise<void> {
    await Promise.allSettled([
      this.checkRouteDeviation(ctx),
      this.checkGeofenceExit(ctx),
      this.checkLongIdle(ctx),
      this.checkSpeedAnomaly(ctx),
      this.refreshEta(ctx),
    ]);
  }

  // ── 1. Route Deviation ─────────────────────────────────────────────────────

  private async checkRouteDeviation(ctx: MonitorContext): Promise<void> {
    const directions = await fetchDirections(
      ctx.currentLat, ctx.currentLng,
      ctx.destinationLat, ctx.destinationLng,
    );
    if (!directions) return;

    const distFromRoute = minDistanceToPolyline(
      ctx.currentLat,
      ctx.currentLng,
      directions.polylinePoints,
    );

    if (distFromRoute > ROUTE_DEVIATION_THRESHOLD_M) {
      const alreadyOpen = await this.gpsAlertModel.hasOpenAlert(
        ctx.sessionId,
        'route_deviation',
      );
      if (alreadyOpen) return;

      const alert = await this.gpsAlertModel.create({
        bookingId: ctx.bookingId,
        providerId: ctx.providerId,
        sessionId: ctx.sessionId,
        alertType: 'route_deviation',
        detail: { deviationMeters: Math.round(distFromRoute) },
      });

      socketEmitter.emitGpsAlert(ctx.bookingId, {
        alertId: alert.id,
        type: 'route_deviation',
        bookingId: ctx.bookingId,
      });

      logger.warn(
        { bookingId: ctx.bookingId, deviationMeters: distFromRoute },
        'GPS: route deviation alert raised',
      );
    }
  }

  // ── 2. Geofence Exit ───────────────────────────────────────────────────────

  private async checkGeofenceExit(ctx: MonitorContext): Promise<void> {
    // We only care about geofence exit AFTER the provider has arrived
    // Proxy for arrival: last N pings were all within the geofence radius
    const recentPings = await this.gpsLogModel.findRecentBySession(
      ctx.sessionId,
      GEOFENCE_LOCK_IN_PINGS + 1,
    );

    if (recentPings.length < GEOFENCE_LOCK_IN_PINGS) return; // not enough history

    const lockedIn = recentPings
      .slice(1) // exclude the current ping
      .every(
        (p) =>
          haversineMeters(p.lat, p.lng, ctx.destinationLat, ctx.destinationLng) <=
          GEOFENCE_RADIUS_M,
      );
    if (!lockedIn) return; // provider hasn't established presence at site yet

    const currentDistance = haversineMeters(
      ctx.currentLat,
      ctx.currentLng,
      ctx.destinationLat,
      ctx.destinationLng,
    );

    if (currentDistance > GEOFENCE_RADIUS_M) {
      const alreadyOpen = await this.gpsAlertModel.hasOpenAlert(
        ctx.sessionId,
        'geofence_exit',
      );
      if (alreadyOpen) return;

      const alert = await this.gpsAlertModel.create({
        bookingId: ctx.bookingId,
        providerId: ctx.providerId,
        sessionId: ctx.sessionId,
        alertType: 'geofence_exit',
        detail: {
          distanceFromSiteMeters: Math.round(currentDistance),
          geofenceRadiusMeters: GEOFENCE_RADIUS_M,
        },
      });

      socketEmitter.emitGpsAlert(ctx.bookingId, {
        alertId: alert.id,
        type: 'geofence_exit',
        bookingId: ctx.bookingId,
      });

      logger.warn(
        { bookingId: ctx.bookingId, distanceFromSite: currentDistance },
        'GPS: geofence exit alert raised',
      );
    }
  }

  // ── 3. Long Idle ───────────────────────────────────────────────────────────

  private async checkLongIdle(ctx: MonitorContext): Promise<void> {
    // Fetch pings from the last IDLE_WINDOW_MINUTES
    const { rows } = await (this as any).db?.query(
      // Fall back to raw query since model doesn't have a time-window query
      `SELECT
         ST_Y(location::geometry) AS lat,
         ST_X(location::geometry) AS lng,
         recorded_at
       FROM gps_logs
       WHERE session_id = $1
         AND recorded_at >= NOW() - INTERVAL '${IDLE_WINDOW_MINUTES} minutes'
       ORDER BY recorded_at ASC`,
      [ctx.sessionId],
    ) ?? { rows: [] };

    if (rows.length < 2) return;

    const oldest = rows[0] as GpsLog;
    const totalMovement = rows.reduce((acc: number, ping: GpsLog, i: number) => {
      if (i === 0) return acc;
      return acc + haversineMeters(rows[i - 1].lat, rows[i - 1].lng, ping.lat, ping.lng);
    }, 0);

    if (totalMovement < IDLE_MOVEMENT_THRESHOLD_M) {
      const alreadyOpen = await this.gpsAlertModel.hasOpenAlert(
        ctx.sessionId,
        'long_idle',
      );
      if (alreadyOpen) return;

      const alert = await this.gpsAlertModel.create({
        bookingId: ctx.bookingId,
        providerId: ctx.providerId,
        sessionId: ctx.sessionId,
        alertType: 'long_idle',
        detail: {
          idleWindowMinutes: IDLE_WINDOW_MINUTES,
          totalMovementMeters: Math.round(totalMovement),
          since: oldest.recordedAt,
        },
      });

      socketEmitter.emitGpsAlert(ctx.bookingId, {
        alertId: alert.id,
        type: 'long_idle',
        bookingId: ctx.bookingId,
      });
    }
  }

  // ── 4. Speed Anomaly ───────────────────────────────────────────────────────

  private async checkSpeedAnomaly(ctx: MonitorContext): Promise<void> {
    const recentPings = await this.gpsLogModel.findRecentBySession(ctx.sessionId, 2);
    if (recentPings.length < 2) return;

    const [latest, previous] = recentPings;
    const distMeters = haversineMeters(latest.lat, latest.lng, previous.lat, previous.lng);
    const timeDiffSeconds =
      (new Date(latest.recordedAt).getTime() - new Date(previous.recordedAt).getTime()) / 1000;

    if (timeDiffSeconds <= 0) return;

    const speedKmh = (distMeters / timeDiffSeconds) * 3.6;

    if (speedKmh > MAX_REALISTIC_SPEED_KMH) {
      const alreadyOpen = await this.gpsAlertModel.hasOpenAlert(
        ctx.sessionId,
        'speed_anomaly',
      );
      if (alreadyOpen) return;

      await this.gpsAlertModel.create({
        bookingId: ctx.bookingId,
        providerId: ctx.providerId,
        sessionId: ctx.sessionId,
        alertType: 'speed_anomaly',
        detail: {
          computedSpeedKmh: Math.round(speedKmh),
          distanceMeters: Math.round(distMeters),
          timeDiffSeconds: Math.round(timeDiffSeconds),
        },
      });
      // Speed anomalies are internal only — no socket event to the customer
    }
  }

  // ── 5. ETA Refresh ─────────────────────────────────────────────────────────

  private async refreshEta(ctx: MonitorContext): Promise<void> {
    const session = await this.trackingSessionModel.findById(ctx.sessionId);
    if (!session) return;

    // Only refresh ETA if last update was >30 seconds ago (rate-limit Google API calls)
    const now = Date.now();
    const lastUpdate = session.etaUpdatedAt ? new Date(session.etaUpdatedAt).getTime() : 0;
    if (now - lastUpdate < 30_000) return;

    const directions = await fetchDirections(
      ctx.currentLat, ctx.currentLng,
      ctx.destinationLat, ctx.destinationLng,
    );
    if (!directions) return;

    await this.trackingSessionModel.updateEta(ctx.sessionId, {
      etaSeconds: directions.etaSeconds,
      etaDistanceMeters: directions.etaDistanceMeters,
    });

    // Push updated location + ETA to customer via Socket.io
    socketEmitter.emitProviderLocation(ctx.bookingId, {
      bookingId: ctx.bookingId,
      lat: ctx.currentLat,
      lng: ctx.currentLng,
      etaSeconds: directions.etaSeconds,
      etaDistanceMeters: directions.etaDistanceMeters,
    });
  }
}
