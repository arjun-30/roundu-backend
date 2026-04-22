// EXISTING
import { z } from 'zod';

export const updateProviderSchema = z.object({
  body: z.object({
    bio: z.string().max(500, "Bio is too long").optional(),
    isAvailable: z.boolean().optional(),
    serviceRadius: z.number().positive().max(100, "Radius cannot exceed 100km").optional(),
  })
});

export const getProvidersQuerySchema = z.object({
  query: z.object({
    serviceId: z.string().uuid().optional(),
    lat: z.string().transform(Number).optional(),
    lng: z.string().transform(Number).optional(),
    radius: z.string().transform(Number).optional().default("10"),
  })
});
