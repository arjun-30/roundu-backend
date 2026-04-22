// Owner: Dev 4 (User Controller) — consolidated
// Validates: PATCH /api/users/me  and  PUT /api/users/me/preferences

import { z } from 'zod';

// ─── PATCH /api/users/me ──────────────────────────────────────────────────────

export const updateUserSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .min(2, 'Name must be at least 2 characters')
        .max(100, 'Name cannot exceed 100 characters')
        .optional(),

      email: z
        .string()
        .email('Invalid email address')
        .max(255)
        .optional(),

      avatar: z
        .string()
        .url('Avatar must be a valid URL')
        .max(500)
        .optional(),
    })
    .refine(
      (data) =>
        data.name !== undefined ||
        data.email !== undefined ||
        data.avatar !== undefined,
      { message: 'At least one field (name, email, avatar) must be provided' },
    ),
});

// ─── PUT /api/users/me/preferences ───────────────────────────────────────────

export const updatePreferencesSchema = z.object({
  body: z
    .object({
      notifications: z.boolean().optional(),
      language: z
        .string()
        .min(2, 'Language code too short')
        .max(10, 'Language code too long')
        .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Use a valid locale code e.g. en or en-IN')
        .optional(),
    })
    .refine(
      (data) =>
        data.notifications !== undefined || data.language !== undefined,
      { message: 'At least one preference field must be provided' },
    ),
});

// Inferred types for controllers
export type UpdateUserBody       = z.infer<typeof updateUserSchema>['body'];
export type UpdatePreferencesBody = z.infer<typeof updatePreferencesSchema>['body'];
