// Loads .env.test into process.env BEFORE any src/* module is imported.
// Required because src/config/env.ts validates env at module load and exits
// the process if any required var is missing.

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(__dirname, '..', '.env.test');
if (existsSync(envPath)) {
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

process.env.NODE_ENV = 'test';
