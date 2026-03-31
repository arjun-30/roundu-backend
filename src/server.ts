// Owner: Lead
// Purpose: Entry point --- connects backing services then starts HTTP server

import { createApp } from "./app";
import { connectDatabase, disconnectDatabase } from "./config/database";
import { connectRedis, disconnectRedis } from "./config/redis";
import { env } from "./config/env";
import { logger } from "./utils/logger";

async function bootstrap(): Promise<void> {
  // Connect to backing services before accepting any traffic
  await connectDatabase();
  await connectRedis();

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(
      `🚀 RoundU API running on http://localhost:${env.PORT} [${env.NODE_ENV}]`
    );
  });

  // ── Graceful shutdown ─────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received — shutting down gracefully`);

    server.close(async () => {
      await disconnectDatabase();
      await disconnectRedis();
      logger.info("All connections closed. Goodbye.");
      process.exit(0);
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled promise rejection");
  });

  process.on("uncaughtException", (err) => {
    logger.error({ err }, "Uncaught exception — exiting");
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
