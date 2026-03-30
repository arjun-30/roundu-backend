// src/socket/emitters.ts
// Owner: Lead
// Server → client WebSocket emitters — import these from controllers, never use io directly

import { getIO } from "./index";

export function emitBookingStatusChanged(
  userId: string,
  payload: { bookingId: string; status: string }
) {
  getIO().to(`user:${userId}`).emit("booking:status_changed", payload);
}

export function emitProviderLocationUpdated(
  userId: string,
  payload: { bookingId: string; lat: number; lng: number }
) {
  getIO().to(`user:${userId}`).emit("provider:location_updated", payload);
}

export function emitGpsAlert(
  providerId: string,
  payload: { alertId: string; type: string; bookingId: string }
) {
  getIO().to(`provider:${providerId}`).emit("gps:alert", payload);
}

export function emitNotification(
  userId: string,
  payload: { notificationId: string; title: string }
) {
  getIO().to(`user:${userId}`).emit("notification:new", payload);
}