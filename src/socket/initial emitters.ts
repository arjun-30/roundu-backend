// Owner: Dev 4 — Real-time & Communications
// Purpose: Server-side socket emitters — called from controllers/jobs to push events to clients

import { io } from './index';

// ─── Booking events ───────────────────────────────────────────────────────

/**
 * Notify everyone in a booking room that its status changed.
 * Emitted after PATCH /bookings/:id/status and POST /bookings/:id/cancel.
 */
export function emitBookingStatusChanged(
  bookingId: string,
  status: string,
  note?: string,
): void {
  io.to(`booking:${bookingId}`).emit('booking:status_changed', {
    bookingId,
    status,
    note: note ?? null,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Push a live provider location to everyone tracking this booking.
 * Called from the tracking service after persisting a GPS point.
 */
export function emitProviderLocationUpdated(
  bookingId: string,
  lat: number,
  lng: number,
): void {
  io.to(`booking:${bookingId}`).emit('provider:location_updated', {
    bookingId,
    lat,
    lng,
    timestamp: new Date().toISOString(),
  });
}

// ─── GPS alert events ─────────────────────────────────────────────────────

/**
 * Send a geofence/speed alert to the specific provider.
 * Emitted by the GPS monitor service.
 */
export function emitGpsAlert(
  providerId: string,
  alertId: string,
  alertType: string,
  bookingId: string,
): void {
  io.to(`user:${providerId}`).emit('gps:alert', {
    alertId,
    type: alertType,
    bookingId,
    timestamp: new Date().toISOString(),
  });
}

// ─── Notification events ──────────────────────────────────────────────────

/**
 * Push a new in-app notification to a specific user.
 */
export function emitNotification(
  userId: string,
  notificationId: string,
  title: string,
  body?: string,
): void {
  io.to(`user:${userId}`).emit('notification:new', {
    notificationId,
    title,
    body: body ?? null,
    timestamp: new Date().toISOString(),
  });
}

// ─── Call events ──────────────────────────────────────────────────────────

/**
 * Alert the user that an incoming AI call is being placed.
 * Lets the app show a "Incoming call from RoundU" UI before the phone rings.
 */
export function emitIncomingCall(
  targetUserId: string,
  bookingId: string,
  callerId: string,
): void {
  io.to(`user:${targetUserId}`).emit('call:incoming', {
    bookingId,
    callerId,
    timestamp: new Date().toISOString(),
  });
}
