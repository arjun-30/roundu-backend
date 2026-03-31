// Owner: Dev 3 (User Model) — consolidated into single-dev ownership
// Model:  users + user_preferences tables
// Rule:   ALL raw SQL for users lives here. Controllers call these functions,
//         never write their own queries against the users table.

import { db } from '../config/database';

// ─── Types ───────────────────────────────────────────────────────────────────

export type UserRole = 'user' | 'provider' | 'admin';

/** Full DB row — never returned directly to clients (contains is_blocked etc.) */
export interface UserRow {
  id: string;
  phone: string;
  name: string;
  email: string | null;
  avatar: string | null;
  role: UserRole;
  is_blocked: boolean;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Safe subset returned to the authenticated user themselves */
export type PublicUser = Omit<UserRow, 'is_blocked' | 'deleted_at'>;

/** Fields allowed in a PATCH /users/me body */
export interface UpdateUserInput {
  name?: string;
  email?: string;
  avatar?: string;
}

export interface UserPreferences {
  id: string;
  user_id: string;
  notifications: boolean;
  language: string;
  created_at: Date;
  updated_at: Date;
}

export interface UpdatePreferencesInput {
  notifications?: boolean;
  language?: string;
}

// ─── Column lists ─────────────────────────────────────────────────────────────

/** Columns safe to return to the owning user */
const PUBLIC_COLS = `
  id, phone, name, email, avatar, role, created_at, updated_at
`.trim();

/** WHERE clause that filters out soft-deleted + blocked users */
const ACTIVE_USER = `deleted_at IS NULL AND is_blocked = FALSE`;

// ─── Query functions ──────────────────────────────────────────────────────────

/**
 * Find a user by their UUID.
 * Returns null if not found, soft-deleted, or blocked.
 */
export async function findUserById(id: string): Promise<PublicUser | null> {
  const { rows } = await db.query<PublicUser>(
    `SELECT ${PUBLIC_COLS}
     FROM users
     WHERE id = $1 AND ${ACTIVE_USER}
     LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Find a user by phone number (used by auth controller).
 * Returns the full row (including is_blocked) so the caller can gate on it.
 */
export async function findUserByPhone(phone: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT id, phone, name, email, avatar, role, is_blocked, deleted_at, created_at, updated_at
     FROM users
     WHERE phone = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [phone],
  );
  return rows[0] ?? null;
}

/**
 * Update mutable profile fields.
 * Only applies fields that are present in the input object.
 * Returns the updated public user or null if not found.
 */
export async function updateUser(
  id: string,
  input: UpdateUserInput,
): Promise<PublicUser | null> {
  // Build a dynamic SET clause from only the keys that were provided
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(input.name);
  }
  if (input.email !== undefined) {
    fields.push(`email = $${idx++}`);
    values.push(input.email);
  }
  if (input.avatar !== undefined) {
    fields.push(`avatar = $${idx++}`);
    values.push(input.avatar);
  }

  // Nothing to update
  if (fields.length === 0) return findUserById(id);

  values.push(id); // last param = WHERE id = $N

  const { rows } = await db.query<PublicUser>(
    `UPDATE users
     SET ${fields.join(', ')}
     WHERE id = $${idx} AND ${ACTIVE_USER}
     RETURNING ${PUBLIC_COLS}`,
    values,
  );
  return rows[0] ?? null;
}

/**
 * Soft-delete a user account.
 * Sets deleted_at to NOW() rather than hard-deleting the row.
 * Returns true if the row was found and updated.
 */
export async function softDeleteUser(id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE users
     SET deleted_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

// ─── Preferences ──────────────────────────────────────────────────────────────

/**
 * Fetch preferences for a user.
 * Auto-creates a default preferences row (via upsert) if one doesn't exist yet.
 */
export async function getOrCreatePreferences(
  userId: string,
): Promise<UserPreferences> {
  // Upsert: insert default row if missing, then return current state
  const { rows } = await db.query<UserPreferences>(
    `INSERT INTO user_preferences (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE
       SET user_id = EXCLUDED.user_id  -- no-op update, forces RETURNING
     RETURNING *`,
    [userId],
  );
  return rows[0];
}

/**
 * Update preferences for a user. Only changes fields present in input.
 */
export async function updatePreferences(
  userId: string,
  input: UpdatePreferencesInput,
): Promise<UserPreferences> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.notifications !== undefined) {
    fields.push(`notifications = $${idx++}`);
    values.push(input.notifications);
  }
  if (input.language !== undefined) {
    fields.push(`language = $${idx++}`);
    values.push(input.language);
  }

  // If nothing changed, just return current preferences
  if (fields.length === 0) return getOrCreatePreferences(userId);

  values.push(userId);

  const { rows } = await db.query<UserPreferences>(
    `UPDATE user_preferences
     SET ${fields.join(', ')}
     WHERE user_id = $${idx}
     RETURNING *`,
    values,
  );

  // If the preferences row didn't exist yet, create it first then re-apply
  if (!rows[0]) {
    await getOrCreatePreferences(userId);
    return updatePreferences(userId, input);
  }

  return rows[0];
}
