// Test env setup
// Owner: Dev 4 — Real-time & Communications
// Purpose: Jest globalSetup — spins up test DB, Redis, and Socket.io server before all tests

import { execSync } from 'child_process';

/**
 * Runs ONCE before all test suites.
 * - Ensures test environment variables are set.
 * - Runs pending DB migrations against the test database.
 * - (Redis is handled per-suite via ioredis-mock or a real test Redis.)
 */
export default async function globalSetup(): Promise<void> {
  // ── Guard: only run against the test DB ──────────────────────────────
  process.env.NODE_ENV = 'test';

  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL must be set. Copy .env.test.example to .env.test and fill it in.',
    );
  }

  // Override DATABASE_URL so Sequelize and migrations use the test DB
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

  // ── Run migrations ───────────────────────────────────────────────────
  console.log('[Setup] Running migrations on test database…');
  execSync('npm run migrate', {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
    stdio: 'inherit',
  });

  console.log('[Setup] Global setup complete');
}
