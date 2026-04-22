// Booking Service — Core business logic layer
// No Express types here. All functions are independently testable.
// Controllers call this service; this service calls models + other services.

import { Pool } from 'pg';
import { Server as SocketServer } from 'socket.io';
import {
  Booking,
  BookingSummary,
  BookingStatus,
  CreateBookingInput,
  createBooking,
  findBookingById,
  findBookingsByUserId,
  findBookingsByProviderId,
  updateBookingStatus,
  assignProvider,
  setQuote,
  assertBookingOwner,
} from '../models/booking.model';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateBookingPayload {
  userId: string;
  serviceId: string;
  providerId?: string;
  scheduledAt: string;        // ISO 8601 — validated upstream
  address: {
    lat: number;
    lng: number;
    line1: string;
  };
  notes?: string;
  offerCode?: string;
}

export interface BookingListOptions {
  status?: BookingStatus;
  page: number;
  limit: number;
}

export interface StatusUpdatePayload {
  status: 'confirmed' | 'in_progress' | 'completed';  // only provider-allowed transitions
  note?: string;
}

export interface CancelPayload {
  reason?: string;
  cancelledBy: 'user' | 'provider' | 'admin' | 'system';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Emit a socket event when booking status changes */
function emitStatusChange(
  io: SocketServer | null,
  bookingId: string,
  status: BookingStatus,
): void {
  if (!io) return;
  // Room key: `booking:<bookingId>` — socket handlers join this room
  io.to(`booking:${bookingId}`).emit('booking:status_changed', {
    bookingId,
    status,
  });
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Create a booking.
 *
 * Flow:
 * 1. Fetch service to get base price + duration
 * 2. Apply offer discount if offerCode provided
 * 3. If no providerId given, run matching (async — provider confirms later)
 * 4. Insert booking row
 * 5. Emit socket event
 */
export async function createNewBooking(
  db: Pool,
  io: SocketServer | null,
  payload: CreateBookingPayload,
): Promise<Booking> {
  // 1. Fetch service
  const serviceResult = await db.query<{
    id: string;
    base_price: number;
    duration_minutes: number | null;
    is_active: boolean;
  }>(
    'SELECT id, base_price, duration_minutes, is_active FROM services WHERE id = $1',
    [payload.serviceId],
  );

  if (serviceResult.rows.length === 0) {
    throw Object.assign(new Error('Service not found'), {
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  }

  const service = serviceResult.rows[0];

  if (!service.is_active) {
    throw Object.assign(new Error('This service is not currently available'), {
      statusCode: 422,
      code: 'UNPROCESSABLE',
    });
  }

  // 2. Apply offer discount
  let discountAmount = 0;
  let offerCode: string | undefined;

  if (payload.offerCode) {
    const offerResult = await db.query<{
      discount_type: string;
      discount_value: number;
    }>(
      `SELECT discount_type, discount_value
       FROM offers
       WHERE code = $1
         AND is_active = true
         AND (valid_from IS NULL OR valid_from <= NOW())
         AND (valid_until IS NULL OR valid_until >= NOW())`,
      [payload.offerCode.toUpperCase()],
    );

    if (offerResult.rows.length > 0) {
      const offer = offerResult.rows[0];
      offerCode = payload.offerCode.toUpperCase();

      if (offer.discount_type === 'percentage') {
        discountAmount = Math.round((service.base_price * offer.discount_value) / 100);
      } else {
        discountAmount = Math.min(offer.discount_value, service.base_price);
      }
    }
  }

  const totalAmount = Math.max(0, service.base_price - discountAmount);

  // 3. Validate provider if explicitly specified
  if (payload.providerId) {
    const providerCheck = await db.query(
      `SELECT id FROM providers
       WHERE id = $1
         AND is_approved = true
         AND is_available = true`,
      [payload.providerId],
    );

    if (providerCheck.rows.length === 0) {
      throw Object.assign(new Error('Specified provider is not available'), {
        statusCode: 422,
        code: 'UNPROCESSABLE',
      });
    }
  }

  // 4. Create booking
  const input: CreateBookingInput = {
    userId: payload.userId,
    serviceId: payload.serviceId,
    providerId: payload.providerId,
    scheduledAt: new Date(payload.scheduledAt),
    address: {
      line1: payload.address.line1,
      lat: payload.address.lat,
      lng: payload.address.lng,
    },
    basePrice: service.base_price,
    totalAmount,
    discountAmount,
    offerCode,
    notes: payload.notes,
    durationMinutes: service.duration_minutes ?? undefined,
  };

  const booking = await createBooking(db, input);

  // 5. Emit socket event
  emitStatusChange(io, booking.id, booking.status);

  return booking;
}

/**
 * Get paginated booking list for a user.
 * Both users (their own) and admins (any user's) can call this.
 */
export async function getUserBookings(
  db: Pool,
  userId: string,
  opts: BookingListOptions,
): Promise<{ data: BookingSummary[]; total: number; page: number; limit: number }> {
  const result = await findBookingsByUserId(db, userId, opts);
  return { ...result, page: opts.page, limit: opts.limit };
}

/**
 * Get paginated booking list for a provider (their assigned jobs).
 */
export async function getProviderBookings(
  db: Pool,
  providerId: string,
  opts: BookingListOptions,
): Promise<{ data: BookingSummary[]; total: number; page: number; limit: number }> {
  const result = await findBookingsByProviderId(db, providerId, opts);
  return { ...result, page: opts.page, limit: opts.limit };
}

/**
 * Get full booking details. Enforces access control:
 * - User can only see their own bookings
 * - Provider can see bookings assigned to them
 * - Admin can see any
 */
export async function getBookingDetails(
  db: Pool,
  bookingId: string,
  requesterId: string,
  requesterRole: 'user' | 'provider' | 'admin',
): Promise<Booking> {
  const booking = await findBookingById(db, bookingId);

  if (!booking) {
    throw Object.assign(new Error('Booking not found'), {
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  }

  if (requesterRole === 'admin') return booking;

  if (requesterRole === 'provider' && booking.providerId !== requesterId) {
    throw Object.assign(new Error('Forbidden'), { statusCode: 403, code: 'FORBIDDEN' });
  }

  if (requesterRole === 'user' && booking.userId !== requesterId) {
    throw Object.assign(new Error('Forbidden'), { statusCode: 403, code: 'FORBIDDEN' });
  }

  return booking;
}

/**
 * Provider updates booking status (confirm → in_progress → completed).
 * Only the assigned provider can do this.
 */
export async function updateStatus(
  db: Pool,
  io: SocketServer | null,
  bookingId: string,
  providerId: string,
  payload: StatusUpdatePayload,
): Promise<Booking> {
  const booking = await findBookingById(db, bookingId);

  if (!booking) {
    throw Object.assign(new Error('Booking not found'), {
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  }

  if (booking.providerId !== providerId) {
    throw Object.assign(
      new Error('You are not the assigned provider for this booking'),
      { statusCode: 403, code: 'FORBIDDEN' },
    );
  }

  const updated = await updateBookingStatus(db, bookingId, {
    status: payload.status,
    providerNote: payload.note,
  });

  if (!updated) {
    throw Object.assign(
      new Error(`Cannot transition booking from '${booking.status}' to '${payload.status}'`),
      { statusCode: 400, code: 'VALIDATION_ERROR' },
    );
  }

  emitStatusChange(io, bookingId, payload.status);

  return updated;
}

/**
 * Cancel a booking with IRCTC-style refund calculation.
 * Any authenticated user can cancel their own booking.
 * Admin can cancel any booking.
 * The actual Stripe refund is triggered by cancellation.service.ts (Dev 1).
 */
export async function cancelBooking(
  db: Pool,
  io: SocketServer | null,
  bookingId: string,
  requesterId: string,
  requesterRole: 'user' | 'provider' | 'admin',
  payload: CancelPayload,
): Promise<{
  booking: Booking;
  message: string;
}> {
  const booking = await findBookingById(db, bookingId);

  if (!booking) {
    throw Object.assign(new Error('Booking not found'), {
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  }

  // Authorization
  if (requesterRole === 'user' && booking.userId !== requesterId) {
    throw Object.assign(new Error('Forbidden'), { statusCode: 403, code: 'FORBIDDEN' });
  }
  if (requesterRole === 'provider' && booking.providerId !== requesterId) {
    throw Object.assign(new Error('Forbidden'), { statusCode: 403, code: 'FORBIDDEN' });
  }

  // State guard
  const cancellableStates: BookingStatus[] = ['pending', 'confirmed'];
  if (!cancellableStates.includes(booking.status)) {
    throw Object.assign(
      new Error(`Cannot cancel a booking with status '${booking.status}'`),
      { statusCode: 400, code: 'VALIDATION_ERROR' },
    );
  }

  const cancelledBy = requesterRole === 'admin' ? 'admin' : requesterRole;

  const updated = await updateBookingStatus(db, bookingId, {
    status: 'cancelled',
    cancelledBy,
    cancellationReason: payload.reason,
  });

  if (!updated) {
    throw Object.assign(new Error('Failed to cancel booking'), {
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
  }

  emitStatusChange(io, bookingId, 'cancelled');

  return {
    booking: updated,
    message: 'Booking cancelled. Refund will be processed per cancellation policy.',
  };
}

/**
 * Timeline: ordered list of status-change events for a booking.
 * Reads from a booking_timeline table (if present) or synthesises from booking row.
 * This is what the controller's getTimeline endpoint exposes.
 */
export async function getBookingTimeline(
  db: Pool,
  bookingId: string,
  requesterId: string,
  requesterRole: 'user' | 'provider' | 'admin',
): Promise<{ event: string; timestamp: Date; note?: string }[]> {
  // Verify access
  await getBookingDetails(db, bookingId, requesterId, requesterRole);

  // Query timeline events table (populated by status-change triggers/service calls)
  const result = await db.query<{
    event: string;
    created_at: Date;
    note: string | null;
  }>(
    `SELECT event, created_at, note
     FROM booking_timeline
     WHERE booking_id = $1
     ORDER BY created_at ASC`,
    [bookingId],
  );

  return result.rows.map((r) => ({
    event: r.event,
    timestamp: r.created_at,
    note: r.note ?? undefined,
  }));
}
