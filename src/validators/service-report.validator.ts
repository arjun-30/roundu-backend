// DEV 3
// src/validators/service-report.validator.ts
// Zod schemas for all /api/service-reports endpoints.
//
// Consumed by:
//   service-report.routes.ts     → validate(schema) middleware
//   service-report.controller.ts → TypeScript types for req.body / req.params
//
// Endpoints covered:
//   POST /api/service-reports              — submit report (provider)
//   GET  /api/service-reports/:bookingId   — get report for a booking (bearer)
//
// API Contract ref: §17 Service Reports

import { z } from 'zod';

// ─── Shared Primitives ────────────────────────────────────────────────────────

/**
 * A single material/part used during the service job.
 *
 * Exported so admin reports or analytics validators can reuse the same shape
 * without duplicating the field constraints.
 *
 * Fields:
 *   name     — human-readable material name (e.g. "Copper pipe", "Washer set")
 *   quantity — how many units were used (must be > 0)
 *   unit     — measurement unit displayed alongside quantity (e.g. "pcs", "kg", "litre")
 *   cost     — optional provider-side cost record in paise; NOT shown to customers
 */
export const materialSchema = z.object({
  name: z
    .string({ required_error: 'material name is required' })
    .min(1, 'material name cannot be empty')
    .max(100, 'material name must be 100 characters or less')
    .trim(),

  quantity: z
    .number({ required_error: 'quantity is required' })
    .positive('quantity must be greater than 0')
    // Allow decimals (e.g. 0.5 kg) but cap at a reasonable precision.
    .multipleOf(0.01, 'quantity supports up to 2 decimal places'),

  unit: z
    .string({ required_error: 'unit is required' })
    .min(1, 'unit cannot be empty')
    .max(30, 'unit must be 30 characters or less')
    .trim(),

  cost: z
    .number()
    .int('cost must be an integer in paise')
    .positive('cost must be greater than 0')
    .optional(), // Internal provider record — not required, not shown to customers.
});

export type MaterialInput = z.infer<typeof materialSchema>;

// ─── POST /api/service-reports ────────────────────────────────────────────────

/**
 * Validates the request body when a provider submits a post-job service report.
 * Auth: provider
 *
 * Fields:
 *   bookingId — the completed booking this report belongs to
 *   workDone  — plain-text description of what was done (min 10 chars for substance)
 *   materials — array of parts/materials used (optional, max 50 items)
 *   photos    — array of S3 URLs of before/after photos (optional, max 10)
 *   notes     — internal provider notes not surfaced to the customer (optional)
 *
 * Business constraints enforced:
 *   - workDone minimum of 10 chars prevents empty/trivial reports.
 *   - photos cap of 10 prevents abuse of S3 storage per report.
 *   - materials cap of 50 covers even large industrial jobs.
 */
export const createServiceReportSchema = z.object({
  body: z.object({
    bookingId: z
      .string({ required_error: 'bookingId is required' })
      .uuid('bookingId must be a valid UUID'),

    workDone: z
      .string({ required_error: 'workDone is required' })
      .min(10, 'workDone must be at least 10 characters — please describe the work performed')
      .max(2000, 'workDone must be 2000 characters or less')
      .trim(),

    materials: z
      .array(materialSchema, {
        invalid_type_error: 'materials must be an array of material objects',
      })
      .max(50, 'Maximum 50 materials allowed per report')
      .optional()
      .default([]),

    photos: z
      .array(
        z
          .string()
          .url('Each photo entry must be a valid URL')
          // Photos must be S3 URLs — validated loosely here since the exact
          // bucket name check happens at upload time (POST /api/upload/presigned).
          .refine(
            (url) => url.includes('amazonaws.com'),
            { message: 'Each photo must be an S3 URL' },
          ),
        { invalid_type_error: 'photos must be an array of URL strings' },
      )
      .max(10, 'Maximum 10 photos allowed per report')
      .optional()
      .default([]),

    notes: z
      .string()
      .max(500, 'notes must be 500 characters or less')
      .trim()
      .optional(),
  }),
});

export type CreateServiceReportInput = z.infer<
  typeof createServiceReportSchema
>['body'];

// ─── GET /api/service-reports/:bookingId ─────────────────────────────────────

/**
 * Validates the :bookingId route param.
 * Auth: bearer (access control — booking owner OR assigned provider — is done in the controller)
 */
export const getServiceReportSchema = z.object({
  params: z.object({
    bookingId: z
      .string({ required_error: 'bookingId is required' })
      .uuid('bookingId must be a valid UUID'),
  }),
});

export type GetServiceReportParams = z.infer<
  typeof getServiceReportSchema
>['params'];
