// DEV 4 — startSession, getSession, getETA, endSession
// Owner: Dev 4 — Referrals + Offers + Portfolio + Tracking
// Controller: tracking.controller.ts

import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { Server as SocketServer } from 'socket.io';
import {
  startSession,
  updateLocation,
  getSession,
  endSession,
} from '../services/tracking.service';
import { sendSuccess } from '../utils/response';

function getDb(req: Request): Pool {
  return req.app.locals.db as Pool;
}

function getIo(req: Request): SocketServer {
  return req.app.locals.io as SocketServer;
}

// ---------------------------------------------------------------------------
// POST /api/tracking/start
// ---------------------------------------------------------------------------
export async function start(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const providerId = req.user!.id;
    const { bookingId } = req.body as { bookingId: string };
    const result = await startSession(getDb(req), providerId, bookingId);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/tracking/:sessionId/location
// ---------------------------------------------------------------------------
export async function updateLoc(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const providerId = req.user!.id;
    const { sessionId } = req.params;
    const { lat, lng, accuracy } = req.body as {
      lat: number;
      lng: number;
      accuracy?: number;
    };

    await updateLocation(getDb(req), getIo(req), providerId, sessionId, lat, lng, accuracy);
    sendSuccess(res, null, 'Location logged');
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// GET /api/tracking/:sessionId
// ---------------------------------------------------------------------------
export async function get(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { sessionId } = req.params;
    const result = await getSession(getDb(req), sessionId);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/tracking/:sessionId/end
// ---------------------------------------------------------------------------
export async function end(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const providerId = req.user!.id;
    const { sessionId } = req.params;
    const result = await endSession(getDb(req), providerId, sessionId);
    sendSuccess(res, result, 'Tracking session ended');
  } catch (err) {
    next(err);
  }
}