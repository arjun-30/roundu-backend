import express, { Express, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import type { Server as SocketServer } from 'socket.io';
import referralRoutes from '../../src/routes/referral.routes';
import trackingRoutes from '../../src/routes/tracking.routes';
import { errorHandler, notFoundHandler } from '../../src/middleware/errorHandler';

export interface TestApp {
  app: Express;
  io: SocketServer;
  emittedEvents: Array<{ room: string; event: string; payload: unknown }>;
}

/**
 * Minimal Express app wired up with the real implemented routes. Uses a fake
 * Socket.IO server that records every emit so tests can assert broadcasts.
 */
export function buildTestApp(db: Pool): TestApp {
  const app = express();
  app.use(express.json());

  const emittedEvents: TestApp['emittedEvents'] = [];
  const io = makeFakeIo(emittedEvents) as unknown as SocketServer;

  app.locals.db = db;
  app.locals.io = io;

  // Shim: controllers read `req.user.id` (old shape), but the develop branch's
  // AccessTokenPayload uses `sub`. Copy sub → id for test controllers that
  // still use the old field name.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    next();
  });

  app.use('/api/referrals', referralRoutes);
  app.use('/api/tracking', trackingRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, io, emittedEvents };
}

function makeFakeIo(events: TestApp['emittedEvents']) {
  return {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          events.push({ room, event, payload });
        },
      };
    },
  };
}
