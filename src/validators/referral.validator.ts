// Owner: Dev 4 — Referrals + Offers + Portfolio + Tracking
// Validator: referral.validator.ts

import { z } from 'zod';

export const applyReferralSchema = z.object({
  body: z.object({
    code: z
      .string({ required_error: 'Referral code is required' })
      .trim()
      .min(4, 'Code too short')
      .max(20, 'Code too long')
      .toUpperCase(),
  }),
});

export type ApplyReferralInput = z.infer<typeof applyReferralSchema>['body'];