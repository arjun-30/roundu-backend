// src/validators/booking.validator.ts
// Owner: Lead

import { z } from "zod";

const addressSchema = z.object({
  lat:   z.number().min(-90).max(90),
  lng:   z.number().min(-180).max(180),
  line1: z.string().min(5).max(300),
});

export const createBookingSchema = z.object({
  body: z.object({
    serviceId:   z.string().uuid("Invalid serviceId"),
    providerId:  z.string().uuid("Invalid providerId").optional(),
    scheduledAt: z
      .string()
      .datetime({ message: "scheduledAt must be ISO 8601" })
      .refine(
        (val) => new Date(val) > new Date(),
        "scheduledAt must be in the future"
      ),
    address: addressSchema,
    notes:   z.string().max(500).optional(),
  }),
});

export const updateBookingStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    status: z.enum(["confirmed", "in_progress", "completed"]),
    note:   z.string().max(300).optional(),
  }),
});

export const cancelBookingSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    reason: z.string().max(500).optional(),
  }),
});

export const listBookingsSchema = z.object({
  query: z.object({
    status: z
      .enum(["pending", "confirmed", "in_progress", "completed", "cancelled"])
      .optional(),
    page:  z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
});