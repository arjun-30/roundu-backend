// DEV 4 — findByUserId, upsert, getServiceInterests// src/models/preference.model.ts
// Stores per-user preferences: notification settings, language, etc.
// One row per user (upsert pattern — create on first write).
//
// Backs endpoints:
//   GET /api/users/me/preferences    — fetch preferences (bearer)
//   PUT /api/users/me/preferences    — update preferences (bearer)

import { db } from '../config/database';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserPreference {
  id: string;
  user_id: string;
  notifications_enabled: boolean;  // master push notification toggle
  email_notifications: boolean;
  sms_notifications: boolean;
  language: string;                 // BCP-47 locale code, e.g. 'en', 'ta', 'hi'
  // Stored as JSONB — flexible bag for future preference keys
  // without requiring a migration every time a new preference is added.
  extra: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertPreferenceInput {
  notifications?: boolean;   // maps to notifications_enabled
  email_notifications?: boolean;
  sms_notifications?: boolean;
  language?: string;
  extra?: Record<string, unknown>;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Get preferences for a user.
 * Returns sensible defaults if no row exists yet (lazy creation pattern).
 * GET /api/users/me/preferences
 */
export async function findPreferenceByUserId(
  userId: string,
): Promise<UserPreference> {
  const { rows } = await db.query<UserPreference>(
    'SELECT * FROM user_preferences WHERE user_id = $1',
    [userId],
  );

  if (rows[0]) return rows[0];

  // Auto-create with defaults on first access.
  return createDefaultPreference(userId);
}

/**
 * Create a default preference row for a new user.
 * Called lazily by findPreferenceByUserId or eagerly during registration.
 */
export async function createDefaultPreference(
  userId: string,
): Promise<UserPreference> {
  const { rows } = await db.query<UserPreference>(
    `INSERT INTO user_preferences
       (user_id, notifications_enabled, email_notifications, sms_notifications, language, extra)
     VALUES ($1, true, true, true, 'en', '{}')
     ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [userId],
  );
  return rows[0];
}

/**
 * Update preferences for a user.
 * PUT /api/users/me/preferences
 *
 * Uses an upsert so the caller doesn't need to check existence first.
 * `extra` is deep-merged with the existing JSONB value using ||.
 */
export async function upsertPreference(
  userId: string,
  input: UpsertPreferenceInput,
): Promise<UserPreference> {
  const {
    notifications,
    email_notifications,
    sms_notifications,
    language,
    extra,
  } = input;

  const { rows } = await db.query<UserPreference>(
    `INSERT INTO user_preferences
       (user_id, notifications_enabled, email_notifications, sms_notifications, language, extra)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       notifications_enabled = COALESCE($2, user_preferences.notifications_enabled),
       email_notifications   = COALESCE($3, user_preferences.email_notifications),
       sms_notifications     = COALESCE($4, user_preferences.sms_notifications),
       language              = COALESCE($5, user_preferences.language),
       -- Merge JSONB: existing keys not in $6 are preserved.
       extra                 = COALESCE(user_preferences.extra, '{}') || COALESCE($6::jsonb, '{}'),
       updated_at            = now()
     RETURNING *`,
    [
      userId,
      notifications ?? null,
      email_notifications ?? null,
      sms_notifications ?? null,
      language ?? null,
      extra ? JSON.stringify(extra) : null,
    ],
  );
  return rows[0];
}

/**
 * Check if push notifications are enabled for a user.
 * Called by FCM service before sending a push to avoid sending to opted-out users.
 */
export async function isPushEnabled(userId: string): Promise<boolean> {
  const { rows } = await db.query<{ notifications_enabled: boolean }>(
    'SELECT notifications_enabled FROM user_preferences WHERE user_id = $1',
    [userId],
  );
  // Default to true if no preference row yet (new user).
  return rows[0]?.notifications_enabled ?? true;
}

/**
 * Bulk-fetch push-enabled status for a list of users.
 * Used when fanning out notifications to multiple users.
 */
export async function getPushEnabledMap(
  userIds: string[],
): Promise<Map<string, boolean>> {
  if (userIds.length === 0) return new Map();

  const { rows } = await db.query<{
    user_id: string;
    notifications_enabled: boolean;
  }>(
    `SELECT user_id, notifications_enabled
     FROM user_preferences
     WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );

  const map = new Map<string, boolean>();
  // Users with no preference row default to push-enabled.
  for (const id of userIds) map.set(id, true);
  for (const row of rows) map.set(row.user_id, row.notifications_enabled);

  return map;
}
