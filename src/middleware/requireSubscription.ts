// TECH LEAD — Check active subscription
// Owner: Dev 2 — Subscriptions + Notifications
import { Request, Response, NextFunction } from 'express';
import { checkFeatureAccess } from '../services/subscription.service';

/**
 * Gate a route to pro subscribers only.
 * Usage: router.get('/priority-match', auth, requireSubscription, handler)
 */
export async function requireSubscription(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const hasAccess = await checkFeatureAccess(req.user!.id);
  if (!hasAccess) {
    res.status(403).json({
      success: false,
      error: {
        code:    'FORBIDDEN',
        message: 'This feature requires an active subscription. Upgrade at /api/subscriptions/plans.',
      },
    });
    return;
  }
  next();
}
