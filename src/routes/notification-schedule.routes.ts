// DEV 2
// Owner: Dev 2 — Subscriptions + Notifications
import { Router } from 'express';
import { auth }          from '../middleware/auth';
import { requireRole }   from '../middleware/requireRole';
import { validate }      from '../middleware/validate';
import { scheduleNotificationSchema } from '../validators/subscription.validator';
import * as ctrl         from '../controllers/notification-schedule.controller';

const router = Router();

router.get ('/',            auth, ctrl.listNotifications);
router.patch('/:id/read',   auth, ctrl.markAsRead);
router.post ('/schedule',   auth, requireRole('admin'), validate(scheduleNotificationSchema), ctrl.scheduleNotification);

export default router;
