// Owner: Lead
// Purpose: ioredis singleton --- import `redis` everywhere

import Redis from "ioredis";
import { env } from "./env";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,
});

/**
 * Verify connectivity --- called once at server startup.
 * Throws on failure so the process exits instead of serving dead traffic.
 */
export async function connectRedis(): Promise<void> {
  try {
    await redis.connect();
    await redis.ping();
    console.log("✅ Redis connected");
  } catch (err) {
    console.error("❌ Redis connection failed:", err);
    throw err;
  }
}

/**
 * Graceful shutdown --- close the Redis connection before the process exits.
 */
export async function disconnectRedis(): Promise<void> {
  await redis.quit();
  console.log("🔌 Redis connection closed");
}
