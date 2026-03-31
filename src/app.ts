// Owner: Lead
// Purpose: Express app factory --- assembles all middleware and routes

import express, { Application } from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import { env, isDev } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { logger } from "./utils/logger";
import apiRouter from "./routes/index";

export function createApp(): Application {
  const app = express();

  // ── Security headers ─────────────────────────────────────
  app.use(helmet());

  // ── CORS ─────────────────────────────────────────────────
  const allowedOrigins = env.CORS_ORIGINS.split(",").map((o) => o.trim());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, curl)
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS: origin ${origin} not allowed`));
        }
      },
      credentials: true,
    })
  );

  // ── Body parsing ─────────────────────────────────────────
  // Raw body must be preserved on the Stripe webhook route for
  // signature verification --- register it before express.json()
  app.use(
    "/api/v1/payments/webhook",
    express.raw({ type: "application/json" })
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  // ── Compression ──────────────────────────────────────────
  app.use(compression());

  // ── Request logging (dev only) ───────────────────────────
  if (isDev) {
    app.use((req, _res, next) => {
      logger.debug(`→ ${req.method} ${req.path}`);
      next();
    });
  }

  // ── API routes ───────────────────────────────────────────
  app.use("/api/v1", apiRouter);

  // ── 404 handler (must come after routes) ─────────────────
  app.use(notFoundHandler);

  // ── Global error handler (must be last) ──────────────────
  app.use(errorHandler);

  return app;
}
