// src/models/booking.model.ts
// Owner: Lead (shared read) / Dev 1 (payment fields) / Dev 4 (tracking integration)

import { db } from "../config/database";
import { Knex } from "knex";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled";

export type PaymentStatus = "unpaid" | "paid" | "refunded" | "partial_refund";

export interface BookingAddress {
  line1: string;
  lat:   number;
  lng:   number;
}

export interface Booking {
  id:              string;
  user_id:         string;
  provider_id:     string | null;
  service_id:      string;
  scheduled_at:    Date;
  started_at:      Date | null;
  completed_at:    Date | null;
  status:          BookingStatus;
  status_note:     string | null;
  address_line1:   string;
  address_lat:     number;
  address_lng:     number;
  base_price:      number;
  discount_amount: number;
  final_price:     number;
  currency:        string;
  offer_id:        string | null;
  coupon_code:     string | null;
  payment_status:  PaymentStatus;
  payment_id:      string | null;
  cancelled_by:    string | null;
  cancelled_at:    Date | null;
  cancel_reason:   string | null;
  refund_amount:   number | null;
  notes:           string | null;
  is_rated:        boolean;
  created_at:      Date;
  updated_at:      Date;
}

export interface CreateBookingData {
  user_id:         string;
  provider_id?:    string;
  service_id:      string;
  scheduled_at:    Date | string;
  address:         BookingAddress;
  base_price:      number;
  discount_amount?: number;
  final_price:     number;
  offer_id?:       string;
  coupon_code?:    string;
  notes?:          string;
}

export interface BookingFilters {
  user_id?:        string;
  provider_id?:    string;
  status?:         BookingStatus | BookingStatus[];
  payment_status?: PaymentStatus;
  from?:           Date | string;
  to?:             Date | string;
  page?:           number;
  limit?:          number;
}

// ── Table name ────────────────────────────────────────────────────────────────

const TABLE        = "bookings";
const STATUS_LOG   = "booking_status_logs";

// ── Query builder ─────────────────────────────────────────────────────────────

function query(trx?: Knex.Transaction) {
  return (trx ?? db)(TABLE);
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createBooking(
  data: CreateBookingData,
  trx?: Knex.Transaction
): Promise<Booking> {
  const [booking] = await query(trx)
    .insert({
      user_id:         data.user_id,
      provider_id:     data.provider_id ?? null,
      service_id:      data.service_id,
      scheduled_at:    data.scheduled_at,
      address_line1:   data.address.line1,
      address_lat:     data.address.lat,
      address_lng:     data.address.lng,
      base_price:      data.base_price,
      discount_amount: data.discount_amount ?? 0,
      final_price:     data.final_price,
      offer_id:        data.offer_id ?? null,
      coupon_code:     data.coupon_code ?? null,
      notes:           data.notes ?? null,
      status:          "pending",
      payment_status:  "unpaid",
    })
    .returning("*");

  return booking;
}

// ── Find by ID ────────────────────────────────────────────────────────────────

export async function findBookingById(
  id: string,
  trx?: Knex.Transaction
): Promise<Booking | null> {
  const row = await query(trx).where({ id }).first();
  return row ?? null;
}

/**
 * Find booking and verify it belongs to the given userId.
 * Returns null if not found or not owned.
 */
export async function findBookingByIdForUser(
  id: string,
  userId: string
): Promise<Booking | null> {
  const row = await query()
    .where({ id, user_id: userId })
    .first();
  return row ?? null;
}

/**
 * Find booking and verify it belongs to the given providerId.
 */
export async function findBookingByIdForProvider(
  id: string,
  providerId: string
): Promise<Booking | null> {
  const row = await query()
    .where({ id, provider_id: providerId })
    .first();
  return row ?? null;
}

// ── List with filters ─────────────────────────────────────────────────────────

export async function listBookings(filters: BookingFilters): Promise<{
  data:  Booking[];
  total: number;
  page:  number;
  limit: number;
}> {
  const page  = Math.max(1, filters.page  ?? 1);
  const limit = Math.min(100, filters.limit ?? 20);
  const offset = (page - 1) * limit;

  function applyFilters(qb: Knex.QueryBuilder) {
    if (filters.user_id)        qb.where("user_id", filters.user_id);
    if (filters.provider_id)    qb.where("provider_id", filters.provider_id);
    if (filters.payment_status) qb.where("payment_status", filters.payment_status);

    if (filters.status) {
      const statuses = Array.isArray(filters.status)
        ? filters.status
        : [filters.status];
      qb.whereIn("status", statuses);
    }

    if (filters.from) qb.where("scheduled_at", ">=", filters.from);
    if (filters.to)   qb.where("scheduled_at", "<=", filters.to);

    return qb;
  }

  const [{ count }] = await applyFilters(
    db(TABLE).count("id as count")
  ) as Array<{ count: string }>;

  const data = await applyFilters(
    db(TABLE).select("*").orderBy("scheduled_at", "desc")
  )
    .limit(limit)
    .offset(offset);

  return { data, total: Number(count), page, limit };
}

// ── Update status ─────────────────────────────────────────────────────────────

export const VALID_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending:     ["confirmed", "cancelled"],
  confirmed:   ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed:   [],
  cancelled:   [],
};

export async function updateBookingStatus(
  id: string,
  newStatus: BookingStatus,
  changedBy: string,
  note?: string,
  trx?: Knex.Transaction
): Promise<Booking> {
  const t = trx ?? db;

  const current = await findBookingById(id, trx);
  if (!current) throw new Error(`Booking ${id} not found`);

  const allowed = VALID_TRANSITIONS[current.status];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid transition: ${current.status} → ${newStatus}`
    );
  }

  const extraFields: Partial<Booking> = {};
  if (newStatus === "in_progress") extraFields.started_at   = new Date();
  if (newStatus === "completed")   extraFields.completed_at = new Date();

  const [updated] = await t(TABLE)
    .where({ id })
    .update({ status: newStatus, status_note: note ?? null, ...extraFields })
    .returning("*");

  // Audit log
  await t(STATUS_LOG).insert({
    booking_id:  id,
    from_status: current.status,
    to_status:   newStatus,
    changed_by:  changedBy,
    note:        note ?? null,
  });

  return updated;
}

// ── Assign provider ───────────────────────────────────────────────────────────

export async function assignProvider(
  id: string,
  providerId: string,
  trx?: Knex.Transaction
): Promise<Booking> {
  const [updated] = await query(trx)
    .where({ id })
    .update({ provider_id: providerId })
    .returning("*");
  return updated;
}

// ── Cancel ────────────────────────────────────────────────────────────────────

export interface CancelBookingData {
  cancelledBy:   string;
  reason?:       string;
  refundAmount?: number;
}

export async function cancelBooking(
  id: string,
  data: CancelBookingData,
  trx?: Knex.Transaction
): Promise<Booking> {
  const [updated] = await query(trx)
    .where({ id })
    .update({
      status:        "cancelled",
      cancelled_by:  data.cancelledBy,
      cancelled_at:  db.fn.now(),
      cancel_reason: data.reason ?? null,
      refund_amount: data.refundAmount ?? null,
      payment_status: data.refundAmount ? "refunded" : undefined,
    })
    .returning("*");

  await (trx ?? db)(STATUS_LOG).insert({
    booking_id:  id,
    from_status: "pending", // overwritten below — just satisfies NOT NULL
    to_status:   "cancelled",
    changed_by:  data.cancelledBy,
    note:        data.reason ?? null,
  });

  return updated;
}

// ── Mark rated ────────────────────────────────────────────────────────────────

export async function markBookingRated(
  id: string,
  trx?: Knex.Transaction
): Promise<void> {
  await query(trx).where({ id }).update({ is_rated: true });
}

// ── Mark paid ─────────────────────────────────────────────────────────────────

export async function markBookingPaid(
  id: string,
  paymentId: string,
  trx?: Knex.Transaction
): Promise<void> {
  await query(trx)
    .where({ id })
    .update({ payment_status: "paid", payment_id: paymentId });
}