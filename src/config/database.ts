import { Pool, QueryResult, QueryResultRow } from 'pg';
import { env, isProd } from './env';
import { logger } from '../utils/logger';

// ── Pool setup ──────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // SSL in production
  ...(isProd ? { ssl: { rejectUnauthorized: false } } : {}),
});

// Log pool errors (don't crash the server)
pool.on('error', (err) => {
  logger.error('Unexpected database pool error', { error: err.message });
});

// Log connections in dev
pool.on('connect', () => {
  logger.debug('New database connection established');
});

// ── Typed query helper ──────────────────────────────────────────────────────
// Usage: const users = await query<User>('SELECT * FROM users WHERE id = $1', [userId]);
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;

    // Log slow queries (>500ms)
    if (duration > 500) {
      logger.warn('Slow query detected', {
        query: text.substring(0, 200),
        duration: `${duration}ms`,
        rows: result.rowCount ?? 0,
      });
    }

    // Log all queries in development
    if (!isProd) {
      logger.debug('Query executed', {
        query: text.substring(0, 100),
        duration: `${duration}ms`,
        rows: result.rowCount ?? 0,
      });
    }

    return result;
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    logger.error('Database query failed', {
      query: text.substring(0, 200),
      params: params?.map((p) =>
        typeof p === 'string' && p.length > 50 ? p.substring(0, 50) + '...' : p,
      ),
      error: err?.message,
      code: err?.code,
    });
    throw error;
  }
}

// ── Query one row (returns T | null) ────────────────────────────────────────
// Usage: const user = await queryOne<User>('SELECT * FROM users WHERE id = $1', [userId]);
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
}

// ── Query many rows ─────────────────────────────────────────────────────────
export async function queryMany<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await query<T>(text, params);
  return result.rows;
}

// ── Execute (INSERT/UPDATE/DELETE) — returns row count ──────────────────────
export async function execute(text: string, params?: unknown[]): Promise<number> {
  const result = await query(text, params);
  return result.rowCount ?? 0;
}

// ── Transaction helper ──────────────────────────────────────────────────────
// Usage: await transaction(async (client) => { await client.query(...); await client.query(...); });
export async function transaction<T>(
  callback: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ── Health check ────────────────────────────────────────────────────────────
export async function dbHealthCheck(): Promise<boolean> {
  try {
    const result = await queryOne<{ now: Date }>('SELECT NOW() as now');
    return result !== null;
  } catch {
    return false;
  }
}

// ── Pool stats (for monitoring) ─────────────────────────────────────────────
export function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}

// ── Connect / disconnect (used by server.ts bootstrap) ─────────────────────
export async function connectDatabase(): Promise<void> {
  // Ping once to surface bad credentials / network at startup instead of on
  // first request. Uses the same pool — no standalone connection created.
  const healthy = await dbHealthCheck();
  if (!healthy) {
    throw new Error('Database health check failed at startup');
  }
  logger.info('Database connection established');
}

export async function disconnectDatabase(): Promise<void> {
  await closePool();
}

// ── Graceful shutdown ───────────────────────────────────────────────────────
export async function closePool(): Promise<void> {
  logger.info('Closing database pool...');
  await pool.end();
  logger.info('Database pool closed');
}

export { pool };
