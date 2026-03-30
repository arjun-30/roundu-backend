// DEV 2 — getPlans, subscribe, getMine, pause, cancel, resume
// Owner: Dev 2 — Subscriptions + Notifications
import { Request, Response, NextFunction } from 'express';
import * as SubscriptionService from '../services/subscription.service';
import { success } from '../utils/response';

export async function getPlans(req: Request, res: Response, next: NextFunction) {
  try {
    const plans = await SubscriptionService.listPlans();
    res.json(success(plans));
  } catch (err) { next(err); }
}

export async function subscribe(req: Request, res: Response, next: NextFunction) {
  try {
    const { planId, paymentMethodId } = req.body;
    const sub = await SubscriptionService.subscribe(req.user!.id, planId, paymentMethodId);
    res.status(201).json(success(sub));
  } catch (err) { next(err); }
}

export async function getMySubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const sub = await SubscriptionService.getActiveSubscription(req.user!.id);
    res.json(success(sub));
  } catch (err) { next(err); }
}

export async function cancelSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await SubscriptionService.cancelSubscription(req.user!.id);
    res.json(success(result));
  } catch (err) { next(err); }
}
