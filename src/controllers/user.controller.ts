// Owner: Dev 4 (User Controller) — consolidated
// Handles: GET    /api/users/me
//          PATCH  /api/users/me
//          DELETE /api/users/me
//          GET    /api/users/me/preferences
//          PUT    /api/users/me/preferences
// Auth: all endpoints require a valid Bearer token (req.user set by authenticate middleware)

import { Request, Response, NextFunction } from 'express';
import {
  findUserById,
  updateUser,
  softDeleteUser,
  getOrCreatePreferences,
  updatePreferences,
} from '../models/user.model';
import { sendSuccess, sendNoContent, sendError } from '../utils/response';
import type { UpdateUserBody, UpdatePreferencesBody } from '../validators/user.validator';

// ─── GET /api/users/me ────────────────────────────────────────────────────────

/**
 * Returns the authenticated user's profile.
 * req.user is guaranteed by the authenticate middleware.
 */
export async function getMe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await findUserById(req.user!.userId);

    if (!user) {
      // Extremely unlikely: valid token but user deleted/blocked between requests
      sendError(res, 'User not found', 404, 'NOT_FOUND');
      return;
    }

    sendSuccess(res, { user });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/users/me ──────────────────────────────────────────────────────

/**
 * Updates name, email, and/or avatar for the authenticated user.
 * Only fields present in the request body are changed.
 */
export async function updateMe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = req.body as UpdateUserBody;

    const user = await updateUser(req.user!.userId, input);

    if (!user) {
      sendError(res, 'User not found', 404, 'NOT_FOUND');
      return;
    }

    sendSuccess(res, { user }, 'Profile updated');
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/users/me ─────────────────────────────────────────────────────

/**
 * Soft-deletes the authenticated user's account.
 * Returns 204 No Content on success.
 * The row is retained in the DB (deleted_at is set) for audit purposes.
 */
export async function deleteMe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const deleted = await softDeleteUser(req.user!.userId);

    if (!deleted) {
      sendError(res, 'User not found', 404, 'NOT_FOUND');
      return;
    }

    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/users/me/preferences ───────────────────────────────────────────

/**
 * Returns the user's notification and language preferences.
 * Auto-creates a default preferences row if none exists yet.
 */
export async function getPreferences(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const preferences = await getOrCreatePreferences(req.user!.userId);
    sendSuccess(res, { preferences });
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/users/me/preferences ───────────────────────────────────────────

/**
 * Updates one or both preference fields (notifications, language).
 * Upserts the preferences row if it doesn't exist.
 */
export async function setPreferences(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = req.body as UpdatePreferencesBody;

    const preferences = await updatePreferences(req.user!.userId, input);
    sendSuccess(res, { preferences }, 'Preferences updated');
  } catch (err) {
    next(err);
  }
}
