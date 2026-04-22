// EXISTING — create, findByProviderId, review
// src/models/document.model.ts
// Stores provider-uploaded verification documents (Aadhaar, PAN, etc.).
// Linked to the KYC flow — documents are submitted during KYC initiation
// and reviewed by admin via /api/admin/kyc/pending.
//
// Backs endpoints:
//   GET  /api/kyc/documents            — list own KYC documents (provider)
//   GET  /api/admin/kyc/pending        — admin review queue
//   PATCH /api/admin/kyc/:id           — approve / reject (admin)

import { db } from '../config/database';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DocumentType = 'aadhaar' | 'pan' | 'driving_license' | 'passport' | 'other';
export type DocumentStatus = 'pending' | 'verified' | 'rejected';

export interface ProviderDocument {
  id: string;
  provider_id: string;
  document_type: DocumentType;
  file_url: string;             // S3 URL
  file_key: string;             // S3 object key (used for signed URL generation)
  status: DocumentStatus;
  rejection_reason: string | null;
  verified_at: Date | null;
  verified_by: string | null;   // admin user ID
  // Metadata from DigiLocker (stored as JSONB)
  digilocker_data: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateDocumentInput {
  provider_id: string;
  document_type: DocumentType;
  file_url: string;
  file_key: string;
  digilocker_data?: Record<string, unknown>;
}

export interface UpdateDocumentStatusInput {
  status: DocumentStatus;
  rejection_reason?: string;
  verified_by?: string;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Insert a document record after the provider uploads the file to S3.
 * Called during KYC initiation or manual upload.
 */
export async function createDocument(
  input: CreateDocumentInput,
): Promise<ProviderDocument> {
  const { rows } = await db.query<ProviderDocument>(
    `INSERT INTO provider_documents
       (provider_id, document_type, file_url, file_key, digilocker_data, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING *`,
    [
      input.provider_id,
      input.document_type,
      input.file_url,
      input.file_key,
      input.digilocker_data ? JSON.stringify(input.digilocker_data) : null,
    ],
  );
  return rows[0];
}

/**
 * List all documents for a provider.
 * GET /api/kyc/documents
 */
export async function findDocumentsByProviderId(
  providerId: string,
): Promise<ProviderDocument[]> {
  const { rows } = await db.query<ProviderDocument>(
    `SELECT * FROM provider_documents
     WHERE provider_id = $1
     ORDER BY created_at DESC`,
    [providerId],
  );
  return rows;
}

/**
 * Find a single document by its ID.
 */
export async function findDocumentById(
  id: string,
): Promise<ProviderDocument | null> {
  const { rows } = await db.query<ProviderDocument>(
    'SELECT * FROM provider_documents WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Find the most recent document of a specific type for a provider.
 * Used to check if a document type has already been submitted.
 */
export async function findLatestDocumentByType(
  providerId: string,
  documentType: DocumentType,
): Promise<ProviderDocument | null> {
  const { rows } = await db.query<ProviderDocument>(
    `SELECT * FROM provider_documents
     WHERE provider_id = $1 AND document_type = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [providerId, documentType],
  );
  return rows[0] ?? null;
}

/**
 * Update document status — approve or reject.
 * PATCH /api/admin/kyc/:id
 *
 * On approval: sets verified_at timestamp and verified_by admin ID.
 * On rejection: records rejection_reason.
 */
export async function updateDocumentStatus(
  id: string,
  updates: UpdateDocumentStatusInput,
): Promise<ProviderDocument | null> {
  const { status, rejection_reason, verified_by } = updates;

  const { rows } = await db.query<ProviderDocument>(
    `UPDATE provider_documents
     SET
       status           = $2,
       rejection_reason = $3,
       verified_by      = $4,
       verified_at      = CASE WHEN $2 = 'verified' THEN now() ELSE NULL END,
       updated_at       = now()
     WHERE id = $1
     RETURNING *`,
    [id, status, rejection_reason ?? null, verified_by ?? null],
  );
  return rows[0] ?? null;
}

/**
 * List all pending documents for the admin review queue.
 * GET /api/admin/kyc/pending
 * Joins with provider + user for display context.
 */
export async function findPendingDocuments(): Promise<
  (ProviderDocument & { provider_name: string; provider_phone: string })[]
> {
  const { rows } = await db.query(
    `SELECT
       pd.*,
       u.name  AS provider_name,
       u.phone AS provider_phone
     FROM provider_documents pd
     JOIN providers p ON p.id  = pd.provider_id
     JOIN users     u ON u.id  = p.user_id
     WHERE pd.status = 'pending'
     ORDER BY pd.created_at ASC`,
  );
  return rows;
}

/**
 * Check whether all required documents for a provider are verified.
 * Used by KYC service to decide if the provider can be marked is_verified=true.
 */
export async function areRequiredDocumentsVerified(
  providerId: string,
): Promise<boolean> {
  const REQUIRED: DocumentType[] = ['aadhaar', 'pan'];

  const { rows } = await db.query<{ document_type: DocumentType }>(
    `SELECT DISTINCT document_type
     FROM provider_documents
     WHERE provider_id = $1 AND status = 'verified'`,
    [providerId],
  );

  const verifiedTypes = new Set(rows.map((r) => r.document_type));
  return REQUIRED.every((t) => verifiedTypes.has(t));
}
