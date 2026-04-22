// DEV 3
// src/validators/kyc.validator.ts
// Zod schemas for all /api/kyc endpoints.
//
// Consumed by:
//   kyc.routes.ts     → validate(schema) middleware
//   kyc.controller.ts → TypeScript types for req.body / req.params
//   admin.validator.ts → re-imports aadhaarSchema / panSchema for admin KYC actions
//
// Endpoints covered:
//   POST /api/kyc/initiate    — start KYC (provider)
//   GET  /api/kyc/status      — get status (provider) — no body/query params
//   POST /api/kyc/callback    — DigiLocker webhook (digilocker-sig) — internal
//   GET  /api/kyc/documents   — list documents (provider) — no body/query params
//
// API Contract ref: §12 KYC

import { z } from 'zod';

// ─── Shared Indian Document Primitives ───────────────────────────────────────
// Exported so admin.validator.ts and any future document validators can
// reuse these without duplicating the regex constraints.

/**
 * Aadhaar number: exactly 12 digits.
 *
 * Real Aadhaar numbers also have a Verhoeff checksum, but we only validate
 * the format here — DigiLocker performs the actual identity verification.
 * We also ensure it does NOT start with 0 or 1 (invalid per UIDAI spec).
 */
export const aadhaarSchema = z
  .string()
  .regex(
    /^[2-9]{1}\d{11}$/,
    'aadhaarNumber must be 12 digits and must not start with 0 or 1',
  )
  .describe('12-digit Aadhaar UID issued by UIDAI');

/**
 * PAN (Permanent Account Number): 5 uppercase letters, 4 digits, 1 uppercase letter.
 * Format: AAAAA9999A
 *
 * The 4th character encodes the taxpayer type:
 *   P = individual, C = company, H = HUF, F = firm, etc.
 * We don't validate the semantic meaning — only the format.
 */
export const panSchema = z
  .string()
  .regex(
    /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,
    'panNumber must be a valid PAN format (e.g. ABCDE1234F)',
  )
  .describe('10-character PAN issued by Income Tax Department of India');

/**
 * Driving licence number: state code (2 chars) + RTO code (2 digits) +
 * year (4 digits) + sequence (7 digits).
 * Format: MH-12-2020-1234567  or  MH122020001234567 (without hyphens).
 *
 * We accept both hyphenated and non-hyphenated forms.
 */
export const drivingLicenceSchema = z
  .string()
  .regex(
    /^[A-Z]{2}[-]?[0-9]{2}[-]?[0-9]{4}[-]?[0-9]{7}$/,
    'drivingLicenceNumber must be a valid Indian driving licence number',
  )
  .describe('Indian driving licence number (e.g. MH-12-2020-1234567)');

/**
 * Indian passport number: one uppercase letter followed by 7 digits.
 * Format: A1234567
 */
export const passportSchema = z
  .string()
  .regex(
    /^[A-Z]{1}[0-9]{7}$/,
    'passportNumber must be a valid Indian passport number (e.g. A1234567)',
  )
  .describe('Indian passport number (e.g. A1234567)');

// ─── Document Type Enum ───────────────────────────────────────────────────────

/**
 * Valid KYC document types supported by the platform.
 * Mirrors the DocumentType union in document.model.ts.
 */
export const documentTypeSchema = z.enum(
  ['aadhaar', 'pan', 'driving_license', 'passport', 'other'],
  {
    required_error: 'documentType is required',
    invalid_type_error:
      "documentType must be one of: 'aadhaar', 'pan', 'driving_license', 'passport', 'other'",
  },
);

export type DocumentType = z.infer<typeof documentTypeSchema>;

// ─── POST /api/kyc/initiate ───────────────────────────────────────────────────

/**
 * Validates the request body for starting a KYC session.
 * Auth: provider
 *
 * Both fields are optional — they are sent as pre-fill hints to DigiLocker's
 * form. The provider still has to authenticate with DigiLocker directly; we
 * are not receiving raw Aadhaar/PAN data to store or process ourselves.
 *
 * If provided, they are validated for format so DigiLocker doesn't receive
 * garbage that would cause a confusing error on their side.
 */
export const initiateKycSchema = z.object({
  body: z.object({
    aadhaarNumber: aadhaarSchema
      .optional()
      .describe('Optional: pre-fills the Aadhaar field in DigiLocker consent form'),

    panNumber: panSchema
      .optional()
      .describe('Optional: pre-fills the PAN field in DigiLocker consent form'),
  }),
});

export type InitiateKycInput = z.infer<typeof initiateKycSchema>['body'];

// ─── GET /api/kyc/status ──────────────────────────────────────────────────────
// No body, params, or query — the provider is identified from the JWT.
// Exported only as a type marker for completeness and future extensibility.

export const getKycStatusSchema = z.object({});

// ─── POST /api/kyc/callback ───────────────────────────────────────────────────

/**
 * Schema for the DigiLocker webhook callback payload.
 *
 * This endpoint is INTERNAL — called by DigiLocker, not by the mobile app.
 * The signature is verified by verifyDigiLockerSignature middleware BEFORE
 * this schema is applied.
 *
 * The body is parsed from rawBody (after HMAC verification), so we validate
 * the parsed JSON structure here to guard against malformed payloads even
 * from a correctly-signed request.
 *
 * DigiLocker payload shape:
 *   {
 *     sessionId:     string   — matches kyc_verifications.session_id
 *     status:        'SUCCESS' | 'FAILURE'
 *     documents:     DocumentPayload[]   — present on SUCCESS
 *     failureReason: string             — present on FAILURE
 *   }
 */
export const kycCallbackDocumentSchema = z.object({
  type: documentTypeSchema,

  fileUrl: z
    .string({ required_error: 'document fileUrl is required' })
    .url('document fileUrl must be a valid URL'),

  fileKey: z
    .string({ required_error: 'document fileKey is required' })
    .min(1, 'document fileKey cannot be empty'),

  // JSONB metadata returned by DigiLocker (e.g. name, DOB from Aadhaar XML).
  // Shape varies by document type — stored as-is, so we use a flexible record.
  data: z
    .record(z.unknown())
    .optional(),
});

export type KycCallbackDocument = z.infer<typeof kycCallbackDocumentSchema>;

export const kycCallbackSchema = z.object({
  body: z.object({
    sessionId: z
      .string({ required_error: 'sessionId is required' })
      .min(1, 'sessionId cannot be empty'),

    status: z.enum(['SUCCESS', 'FAILURE'], {
      required_error: 'status is required',
      invalid_type_error: "status must be 'SUCCESS' or 'FAILURE'",
    }),

    // Only present when status === 'SUCCESS'.
    documents: z
      .array(kycCallbackDocumentSchema)
      .optional()
      .default([]),

    // Only present when status === 'FAILURE'.
    failureReason: z
      .string()
      .max(500)
      .optional(),
  }),
});

export type KycCallbackInput = z.infer<typeof kycCallbackSchema>['body'];

// ─── GET /api/kyc/documents ───────────────────────────────────────────────────
// No body or query params — provider ID comes from JWT.
// Exported for completeness; validate() middleware handles empty schemas gracefully.

export const getKycDocumentsSchema = z.object({});

// ─── Admin: PATCH /api/admin/kyc/:id ─────────────────────────────────────────

/**
 * Validates the admin approve/reject KYC action.
 *
 * API Contract ref: §20 Admin — PATCH /api/admin/kyc/:id
 *
 * Kept here (not in admin.validator.ts) because it is KYC-domain logic,
 * and admin.validator.ts can simply re-export:
 *   export { adminKycActionSchema } from './kyc.validator';
 */
export const adminKycActionSchema = z.object({
  params: z.object({
    id: z
      .string({ required_error: 'KYC record id is required' })
      .uuid('KYC record id must be a valid UUID'),
  }),

  body: z.object({
    status: z.enum(['verified', 'rejected'], {
      required_error: 'status is required',
      invalid_type_error: "status must be 'verified' or 'rejected'",
    }),

    reason: z
      .string()
      .max(500, 'reason must be 500 characters or less')
      .trim()
      // reason is required when rejecting, optional when verifying.
      .optional(),
  })
  // Cross-field validation: reason is required when status is 'rejected'.
  .superRefine((data, ctx) => {
    if (data.status === 'rejected' && !data.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'reason is required when rejecting a KYC application',
      });
    }
  }),
});

export type AdminKycActionInput = z.infer<typeof adminKycActionSchema>['body'];
export type AdminKycActionParams = z.infer<typeof adminKycActionSchema>['params'];
