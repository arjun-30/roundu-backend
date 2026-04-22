// src/controllers/booking.controller.ts
// Owner: Lead (routing) / Dev 1 (payment hooks) / Dev 4 (tracking integration)

import { Request, Response, NextFunction } from "express";
import { db } from "../config/database";
import { Errors } from "../middleware/errorHandler";
import { ok, created } from "../utils/response";
import {
  createBooking,
  findBookingById,
  findBookingByIdForUser,
  findBookingByIdForProvider,
  listBookings,
  updateBookingStatus,
  cancelBooking,
  VALID_TRANSITIONS,
  BookingStatus,
} from "../models/booking.model";
import { matchProvider } from "../services/matching.service";
import { computeCancellationRefund } from "../utils/cancellation-slabs";
import { emitBookingStatusChanged } from "../socket/emitters";
import { db as knex } from "../config/database";

// ── POST /api/bookings ────────────────────────────────────────────────────────

export async function createBookingHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = req.user.sub;
    const { serviceId, providerId, scheduledAt, address, notes } = req.body;

    // Fetch service to snapshot price
    const service = await knex("services")
      .where({ id: serviceId, is_active: true })
      .first();
    if (!service) throw Errors.notFound("Service");

    // Provider matching — explicit or auto-match
    const matchedProviderId = await matchProvider({
      serviceId,
      preferredProviderId: providerId,
      address,
      scheduledAt,
    });

    if (!matchedProviderId) {
      throw Errors.unprocessable("No providers available for this slot");
    }

    const booking = await createBooking({
      user_id:     userId,
      provider_id: matchedProviderId,
      service_id:  serviceId,
      scheduled_at: scheduledAt,
      address,
      base_price:  service.base_price,
      final_price: service.base_price, // offer/coupon applied at payment step
      notes,
    });

    return created(res, booking, "Booking created");
  } catch (err) {
    next(err);
  }
}

// ── GET /api/bookings ─────────────────────────────────────────────────────────

export async function listBookingsHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = req.user.sub;
    const { status, page, limit } = req.query;

    const result = await listBookings({
      user_id: userId,
      status:  status as BookingStatus | undefined,
      page:    page  ? Number(page)  : undefined,
      limit:   limit ? Number(limit) : undefined,
    });

    return ok(res, result);
  } catch (err) {
    next(err);
  }
}

// ── GET /api/bookings/:id ─────────────────────────────────────────────────────

export async function getBookingHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { id } = req.params;
    const userId  = req.user.sub;
    const role    = req.user.role;

    const booking = await findBookingById(id);
    if (!booking) throw Errors.notFound("Booking");

    // Users can only see their own; providers their assigned; admins all
    if (role === "user"     && booking.user_id     !== userId) throw Errors.forbidden();
    if (role === "provider" && booking.provider_id !== userId) throw Errors.forbidden();

    return ok(res, booking);
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/bookings/:id/status — provider action ─────────────────────────

export async function updateBookingStatusHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { id }             = req.params;
    const { status, note }   = req.body;
    const providerId         = req.user.sub;

    const booking = await findBookingByIdForProvider(id, providerId);
    if (!booking) throw Errors.notFound("Booking");

    // Providers can only move to confirmed / in_progress / completed
    const providerAllowed: BookingStatus[] = ["confirmed", "in_progress", "completed"];
    if (!providerAllowed.includes(status)) {
      throw Errors.forbidden("Providers cannot set this status");
    }

    const allowed = VALID_TRANSITIONS[booking.status];
    if (!allowed.includes(status)) {
      throw Errors.badRequest(
        `Cannot transition from '${booking.status}' to '${status}'`
      );
    }

    const updated = await updateBookingStatus(id, status, providerId, note);

    // Real-time push
    emitBookingStatusChanged(booking.user_id, { bookingId: id, status });

    return ok(res, updated);
  } catch (err) {
    next(err);
  }
}

// ── POST /api/bookings/:id/cancel ─────────────────────────────────────────────

export async function cancelBookingHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { id }     = req.params;
    const { reason } = req.body;
    const userId     = req.user.sub;
    const role       = req.user.role;

    const booking = await findBookingById(id);
    if (!booking) throw Errors.notFound("Booking");

    // Ownership check
    if (role === "user"     && booking.user_id     !== userId) throw Errors.forbidden();
    if (role === "provider" && booking.provider_id !== userId) throw Errors.forbidden();

    // Only cancellable states
    const cancellable: BookingStatus[] = ["pending", "confirmed"];
    if (!cancellable.includes(booking.status)) {
      throw Errors.badRequest(
        `Bookings in '${booking.status}' state cannot be cancelled`
      );
    }

    const refundAmount = computeCancellationRefund(booking);

    const cancelled = await knex.transaction(async (trx) => {
      return cancelBooking(
        id,
        { cancelledBy: userId, reason, refundAmount },
        trx
      );
    });

    emitBookingStatusChanged(booking.user_id, { bookingId: id, status: "cancelled" });

    return ok(res, {
      booking:      cancelled,
      refundAmount,
      refundNote:   refundAmount > 0
        ? "Refund will be credited to your wallet within 24 hours"
        : "No refund applicable per cancellation policy",
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/admin/bookings — admin list all ──────────────────────────────────

export async function adminListBookingsHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { status, from, to, page, limit } = req.query;

    const result = await listBookings({
      status:  status as BookingStatus | undefined,
      from:    from  as string | undefined,
      to:      to    as string | undefined,
      page:    page  ? Number(page)  : undefined,
      limit:   limit ? Number(limit) : undefined,
    });

    return ok(res, result);
  } catch (err) {
    next(err);
  }
}