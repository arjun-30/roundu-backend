// DEV 4 — create, findByProviderId, deleteById
// src/models/portfolio.model.ts
// Stores provider portfolio items — before/after photos, work samples, etc.
// Used to build trust with potential customers viewing a provider's profile.
//
// Backs endpoints:
//   GET    /api/portfolio/:providerId  — list portfolio (public)
//   POST   /api/portfolio              — add item (provider)
//   DELETE /api/portfolio/:id          — remove item (provider)

import { db } from '../config/database';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PortfolioItem {
  id: string;
  provider_id: string;
  title: string;
  image_url: string;          // S3 URL — uploaded via /api/upload/presigned
  image_key: string;          // S3 object key (for deletion)
  description: string | null;
  display_order: number;      // for manual ordering on the profile page
  created_at: Date;
  updated_at: Date;
}

export interface CreatePortfolioInput {
  provider_id: string;
  title: string;
  image_url: string;
  image_key: string;
  description?: string;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * List all portfolio items for a provider, ordered for display.
 * GET /api/portfolio/:providerId (public)
 */
export async function findPortfolioByProviderId(
  providerId: string,
): Promise<PortfolioItem[]> {
  const { rows } = await db.query<PortfolioItem>(
    `SELECT * FROM portfolios
     WHERE provider_id = $1
     ORDER BY display_order ASC, created_at DESC`,
    [providerId],
  );
  return rows;
}

/**
 * Find a single portfolio item by ID.
 * Used to verify ownership before deletion.
 */
export async function findPortfolioItemById(
  id: string,
): Promise<PortfolioItem | null> {
  const { rows } = await db.query<PortfolioItem>(
    'SELECT * FROM portfolios WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Add a portfolio item.
 * POST /api/portfolio
 *
 * display_order is set to MAX(existing) + 1 so new items appear last.
 */
export async function createPortfolioItem(
  input: CreatePortfolioInput,
): Promise<PortfolioItem> {
  const { rows } = await db.query<PortfolioItem>(
    `INSERT INTO portfolios
       (provider_id, title, image_url, image_key, description, display_order)
     VALUES (
       $1, $2, $3, $4, $5,
       COALESCE(
         (SELECT MAX(display_order) + 1 FROM portfolios WHERE provider_id = $1),
         1
       )
     )
     RETURNING *`,
    [
      input.provider_id,
      input.title,
      input.image_url,
      input.image_key,
      input.description ?? null,
    ],
  );
  return rows[0];
}

/**
 * Delete a portfolio item.
 * DELETE /api/portfolio/:id
 *
 * Returns the deleted row so the caller can clean up the S3 file using image_key.
 */
export async function deletePortfolioItem(
  id: string,
  providerId: string,   // ownership guard — only the owner can delete
): Promise<PortfolioItem | null> {
  const { rows } = await db.query<PortfolioItem>(
    `DELETE FROM portfolios
     WHERE id = $1 AND provider_id = $2
     RETURNING *`,
    [id, providerId],
  );
  return rows[0] ?? null;
}

/**
 * Count how many portfolio items a provider has.
 * Enforces a reasonable cap (e.g. 20 items) in the controller.
 */
export async function countPortfolioItems(providerId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    'SELECT COUNT(*) FROM portfolios WHERE provider_id = $1',
    [providerId],
  );
  return parseInt(rows[0].count, 10);
}

/**
 * Reorder portfolio items.
 * Accepts an ordered array of IDs and updates display_order accordingly.
 * Used if a drag-to-reorder UI is built in the provider app.
 */
export async function reorderPortfolioItems(
  providerId: string,
  orderedIds: string[],
): Promise<void> {
  if (orderedIds.length === 0) return;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(
        `UPDATE portfolios
         SET display_order = $1, updated_at = now()
         WHERE id = $2 AND provider_id = $3`,
        [i + 1, orderedIds[i], providerId],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
