// DEV 4
import { z } from 'zod';

export const validateOfferSchema = z.object({
  body: z.object({
    code: z.string().min(3).max(20).toUpperCase(),
    bookingId: z.string().uuid("Invalid booking ID"),
  })
});
