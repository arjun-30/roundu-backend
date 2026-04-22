// EXISTING
import { z } from 'zod';

export const createRatingSchema = z.object({
  body: z.object({
    bookingId: z.string().uuid(),
    rating: z.number().min(1).max(5),
    review: z.string().max(500).optional(),
    tags: z.array(z.string()).optional(),
  })
});
