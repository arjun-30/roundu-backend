// TECH LEAD — Winston JSON logger
// Usage:  import { logger } from '@/utils/logger';
//         logger.info('OTP sent', { phone: '91XXXXXXXXXX', purpose: 'auth' });
//         logger.error('MSG91 error', { error: err.message });

import winston from 'winston';

const { combine, timestamp, json, colorize, simple, errors } = winston.format;

const isDev = process.env.NODE_ENV !== 'production';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),

  format: combine(
    errors({ stack: true }),   // capture stack traces on Error objects
    timestamp(),
    json(),
  ),

  defaultMeta: { service: 'roundu-api' },

  transports: [
    new winston.transports.Console({
      // In dev: pretty coloured output; in prod: structured JSON for log aggregators
      format: isDev
        ? combine(colorize(), simple())
        : combine(timestamp(), json()),
    }),
  ],
});

// Convenience: attach child logger factory so callers can add static fields
// e.g.  const log = logger.child({ module: 'otp' });
export type Logger = typeof logger;
