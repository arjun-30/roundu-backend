// DEV 4
import { z } from 'zod';

export const updatePreferenceSchema = z.object({
  body: z.object({
    notifications: z.boolean().optional(),
    language: z.enum(['en', 'hi', 'es']).optional(), // Add supported locales
  })
});
