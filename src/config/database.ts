// Owner: Lead
// Purpose: Knex instance + PostGIS-aware pool — import `db` everywhere

import Knex from "knex";
import { env, isProd } from "./env";

export const db = Knex({
  client: "pg",
  connection: env.DATABASE_URL,
  pool: {
    min: env.DATABASE_POOL_MIN,
    max: env.DATABASE_POOL_MAX,
    // Kill idle connections after 30 s in production
    idleTimeoutMillis: isProd ? 30_000 : 60_000,
    // Hard timeout if a connection can't be acquired
    acquireTimeoutMillis: 10_000,
  },
  acquireConnectionTimeout: 10_000,
  // Log queries in development
  debug: false,
});

/**
 * Verify connectivity — called once at server startup.
 * Throws on failure so the process exits instead of serving dead traffic.
 */
export async function connectDatabase(): Promise<void> {
  try {
    await db.raw("SELECT 1+1 AS result");
    console.log("✅  PostgreSQL connected");
  } catch (err) {
    console.error("❌  PostgreSQL connection failed:", err);
    throw err;
  }
}

/**
 * Graceful shutdown — drain the pool before the process exits.
 */
export async function disconnectDatabase(): Promise<void> {
  await db.destroy();
  console.log("🔌  PostgreSQL pool closed");
}