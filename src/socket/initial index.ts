// TECH LEAD — Socket.io server init + JWT auth + getIO()
// Owner: Dev 4 — Real-time & Communications
// Purpose: Socket.io server initialization — attaches to HTTP server, sets auth middleware

import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { registerSocketHandlers } from './handlers';
import { logger } from '../utils/logger';

export let io: SocketServer;

export interface AuthenticatedSocket extends Socket {
  userId: string;
  role: 'user' | 'provider' | 'admin';
}

/**
 * Bootstrap Socket.io on the existing HTTP server.
 * Call once during app startup after Express is ready.
 */
export function initSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',') ?? '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 30_000,
    pingInterval: 10_000,
  });

  // ── Auth middleware ─────────────────────────────────────────────────────
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ??
      socket.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      return next(new Error('UNAUTHORIZED: No token provided'));
    }

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
        userId: string;
        role: 'user' | 'provider' | 'admin';
      };

      (socket as AuthenticatedSocket).userId = payload.userId;
      (socket as AuthenticatedSocket).role = payload.role;

      next();
    } catch {
      next(new Error('UNAUTHORIZED: Invalid or expired token'));
    }
  });

  // ── Connection handler ──────────────────────────────────────────────────
  io.on('connection', (socket: Socket) => {
    const s = socket as AuthenticatedSocket;
    logger.info(`[Socket] Connected — userId=${s.userId} role=${s.role} socketId=${s.id}`);

    // Each user joins a personal room so we can target them directly
    void s.join(`user:${s.userId}`);

    // Providers also join a providers-only broadcast room
    if (s.role === 'provider') {
      void s.join('providers');
    }

    registerSocketHandlers(s);

    s.on('disconnect', (reason) => {
      logger.info(`[Socket] Disconnected — userId=${s.userId} reason=${reason}`);
    });
  });

  logger.info('[Socket] Socket.io server initialized');
  return io;
}
