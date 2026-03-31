// TECH LEAD + DEV 4 — join/leave booking, location:send with ETA + proximity
// Owner: Dev 4 — Real-time & Communications
// Purpose: Socket.io event handlers — booking status, live location, notifications

import { AuthenticatedSocket } from './index';
import { logger } from '../utils/logger';

// ─── Inbound event payloads (client → server) ─────────────────────────────

interface JoinBookingRoomPayload {
  bookingId: string;
}

interface LocationUpdatePayload {
  bookingId: string;
  lat: number;
  lng: number;
  accuracy?: number;
}

interface MarkNotificationReadPayload {
  notificationId: string;
}

// ─── Register all handlers for a connected socket ─────────────────────────

export function registerSocketHandlers(socket: AuthenticatedSocket): void {
  // ── Join a booking-specific room ──────────────────────────────────────
  // Both the user and provider join to receive real-time updates for that booking.
  socket.on('booking:join', (payload: JoinBookingRoomPayload) => {
    if (!payload?.bookingId) return;

    void socket.join(`booking:${payload.bookingId}`);
    logger.debug(
      `[Socket] userId=${socket.userId} joined room booking:${payload.bookingId}`,
    );
  });

  socket.on('booking:leave', (payload: JoinBookingRoomPayload) => {
    if (!payload?.bookingId) return;
    void socket.leave(`booking:${payload.bookingId}`);
  });

  // ── Provider: push GPS location update ───────────────────────────────
  // The provider app calls this on every location tick during an active booking.
  // Server rebroadcasts to the booking room so the user sees live tracking.
  socket.on('provider:location_update', (payload: LocationUpdatePayload) => {
    if (socket.role !== 'provider') {
      socket.emit('error', { code: 'FORBIDDEN', message: 'Only providers can push location' });
      return;
    }

    if (!payload?.bookingId || payload.lat == null || payload.lng == null) {
      socket.emit('error', { code: 'VALIDATION_ERROR', message: 'Invalid location payload' });
      return;
    }

    // Rebroadcast to the booking room (user + provider both receive it)
    socket.to(`booking:${payload.bookingId}`).emit('provider:location_updated', {
      bookingId: payload.bookingId,
      lat: payload.lat,
      lng: payload.lng,
      accuracy: payload.accuracy ?? null,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Mark notification as read via socket ──────────────────────────────
  socket.on(
    'notification:read',
    (payload: MarkNotificationReadPayload) => {
      if (!payload?.notificationId) return;
      // Acknowledge back to sender (actual DB update is done via REST PATCH)
      socket.emit('notification:read_ack', { notificationId: payload.notificationId });
    },
  );

  // ── Heartbeat / ping-pong ─────────────────────────────────────────────
  socket.on('ping', () => {
    socket.emit('pong', { ts: Date.now() });
  });
}
