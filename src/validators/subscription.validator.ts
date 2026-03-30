// DEV 2
// Owner: Dev 2 — Subscriptions + Notifications
import { z } from 'zod';

export const subscribeSchema = z.object({
  body: z.object({
    planId:          z.string().uuid('planId must be a valid UUID'),
    paymentMethodId: z.string().min(1, 'paymentMethodId is required'),
  }),
});

export const scheduleNotificationSchema = z.object({
  body: z.object({
    userId:      z.string().uuid(),
    title:       z.string().min(1).max(200),
    body:        z.string().min(1),
    scheduledAt: z.string().datetime({ message: 'scheduledAt must be ISO 8601' }),
  }),
});

export type SubscribeInput         = z.infer<typeof subscribeSchema>['body'];
export type ScheduleNotifInput     = z.infer<typeof scheduleNotificationSchema>['body'];
