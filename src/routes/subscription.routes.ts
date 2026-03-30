// DEV 2
// Owner: Dev 2 — Subscriptions + Notifications
import { Router } from 'express';
import { auth }                from '../middleware/auth';
import { validate }            from '../middleware/validate';
import { subscribeSchema }     from '../validators/subscription.validator';
import * as ctrl               from '../controllers/subscription.controller';

const router = Router();

router.get ('/plans',     ctrl.getPlans);                             // public
router.post('/subscribe', auth, validate(subscribeSchema), ctrl.subscribe);
router.get ('/me',        auth, ctrl.getMySubscription);
router.delete('/me',      auth, ctrl.cancelSubscription);

export default router;
