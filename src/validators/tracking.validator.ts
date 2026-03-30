// Owner: Dev 4 — Referrals + Offers + Portfolio + Tracking
// Validator: tracking.validator.ts

import { z } from 'zod';

export const startTrackingSchema = z.object({
  body: z.object({
    bookingId: z
      .string({ required_error: 'bookingId is required' })
      .uuid('bookingId must be a valid UUID'),
  }),
});

export const updateLocationSchema = z.object({
  body: z.object({
    lat: z
      .number({ required_error: 'lat is required' })
      .min(-90)
      .max(90),
    lng: z
      .number({ required_error: 'lng is required' })
      .min(-180)
      .max(180),
    accuracy: z.number().positive().optional(),
  }),
  params: z.object({
    sessionId: z.string().uuid('sessionId must be a valid UUID'),
  }),
});

export type StartTrackingInput = z.infer<typeof startTrackingSchema>['body'];
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>['body'];