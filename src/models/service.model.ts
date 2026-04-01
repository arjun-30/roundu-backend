// EXISTING — findAll, findById, findBySlug
// src/models/service.model.ts
// Base entity — no foreign key deps on other feature models.
//
// Backs endpoints:
//   GET  /api/services          — list all active services (public)
//   GET  /api/services/:id      — get one service (public)
//   POST /api/services          — create (admin)
//   PUT  /api/services/:id      — update (admin)
//   DELETE /api/services/:id    — delete (admin)
//
// Also used by: provider.model, booking.model, offer.model,
//               recommendation.model, rating.model

import { db } from '../config/database';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Service {
  id: string;
  name: string;
  category: string;
  description: string | null;
  base_price: number;          // paise (INR smallest unit)
  duration_minutes: number | null;
  icon_url: string | null;     // S3 URL for the service icon
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateServiceInput {
  name: string;
  category: string;
  description?: string;
  base_price: number;
  duration_minutes?: number;
  icon_url?: string;
}

export interface UpdateServiceInput {
  name?: string;
  category?: string;
  description?: string;
  base_price?: number;
  duration_minutes?: number;
  icon_url?: string;
  is_active?: boolean;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * List all active services.
 * Optionally filter by category or a name search term.
 * Used by GET /api/services (public).
 */
export async function findAllServices(filters?: {
  category?: string;
  search?: string;
}): Promise<Service[]> {
  const conditions: string[] = ['is_active = true'];
  const params: unknown[] = [];

  if (filters?.category) {
    params.push(filters.category);
    conditions.push(`category = $${params.length}`);
  }

  if (filters?.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`name ILIKE $${params.length}`);
  }

  const where = conditions.join(' AND ');

  const { rows } = await db.query<Service>(
    `SELECT * FROM services WHERE ${where} ORDER BY category, name`,
    params,
  );
  return rows;
}

/**
 * Find a single service by ID (active or inactive — admin needs both).
 * Used by GET /api/services/:id (public) and admin operations.
 */
export async function findServiceById(id: string): Promise<Service | null> {
  const { rows } = await db.query<Service>(
    'SELECT * FROM services WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Find multiple services by their IDs in one query.
 * Used by matching.service.ts when resolving provider → service mappings.
 */
export async function findServicesByIds(ids: string[]): Promise<Service[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<Service>(
    'SELECT * FROM services WHERE id = ANY($1::uuid[])',
    [ids],
  );
  return rows;
}

/**
 * Create a new service. Admin only.
 * POST /api/services
 */
export async function createService(input: CreateServiceInput): Promise<Service> {
  const { rows } = await db.query<Service>(
    `INSERT INTO services
       (name, category, description, base_price, duration_minutes, icon_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.name,
      input.category,
      input.description ?? null,
      input.base_price,
      input.duration_minutes ?? null,
      input.icon_url ?? null,
    ],
  );
  return rows[0];
}

/**
 * Update a service. Admin only.
 * PUT /api/services/:id
 * Builds SET clause dynamically — only supplied fields are updated.
 */
export async function updateService(
  id: string,
  updates: UpdateServiceInput,
): Promise<Service | null> {
  const fields = Object.keys(updates) as (keyof UpdateServiceInput)[];
  if (fields.length === 0) return findServiceById(id);

  const setClauses = fields.map((k, i) => `${toSnake(k)} = $${i + 2}`).join(', ');
  const values = fields.map((k) => updates[k]);

  const { rows } = await db.query<Service>(
    `UPDATE services
     SET ${setClauses}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return rows[0] ?? null;
}

/**
 * Hard delete a service. Admin only.
 * DELETE /api/services/:id
 * NOTE: bookings referencing this service are preserved (FK is RESTRICT);
 * deactivate (is_active = false) instead of deleting if bookings exist.
 */
export async function deleteService(id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    'DELETE FROM services WHERE id = $1',
    [id],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Get distinct service categories.
 * Used by the filter UI on the services list screen.
 */
export async function findServiceCategories(): Promise<string[]> {
  const { rows } = await db.query<{ category: string }>(
    'SELECT DISTINCT category FROM services WHERE is_active = true ORDER BY category',
  );
  return rows.map((r) => r.category);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert camelCase input keys to snake_case column names. */
function toSnake(key: string): string {
  return key.replace(/([A-Z])/g, '_$1').toLowerCase();
}
