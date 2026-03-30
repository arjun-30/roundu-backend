// Owner: Dev 4 — Referrals + Offers + Portfolio + Tracking
// Controller: referral.controller.ts

import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import {
  getOrCreateReferralCode,
  applyReferralCode,
  getReferralHistory,
} from '../services/referral.service';
import { sendSuccess } from '../utils/response';

// db is injected via app.locals — set in app.ts: app.locals.db = pool
function getDb(req: Request): Pool {
  return req.app.locals.db as Pool;
}

// ---------------------------------------------------------------------------
// GET /api/referrals/my-code
// ---------------------------------------------------------------------------
export async function getMyCode(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user!.id;
    const result = await getOrCreateReferralCode(getDb(req), userId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/referrals/apply
// ---------------------------------------------------------------------------
export async function applyCode(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user!.id;
    const { code } = req.body as { code: string };
    const result = await applyReferralCode(getDb(req), userId, code);
    sendSuccess(res, result, 'Referral applied — wallet credited');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /api/referrals/history
// ---------------------------------------------------------------------------
export async function getHistory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user!.id;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);

    const result = await getReferralHistory(getDb(req), userId, page, limit);
    sendSuccess(res, { ...result, page, limit });
  } catch (err) {
    next(err);
  }
}