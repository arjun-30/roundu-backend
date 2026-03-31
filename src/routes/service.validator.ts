import { z } from 'zod';

export const createServiceSchema = z.object({
  body: z.object({
    name: z.string().min(3, "Name must be at least 3 characters"),
    category: z.string().uuid("Invalid category ID format"),
    basePrice: z.number().positive("Price must be greater than 0"),
    durationMinutes: z.number().int().positive().optional(),
  })
});

export const updateServiceSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    name: z.string().min(3).optional(),
    basePrice: z.number().positive().optional(),
    isActive: z.boolean().optional(),
  })
});
