// TECH LEAD — Redis-backed rate limiter
import { Request, Response, NextFunction } from 'express';
import { getRedis } from '../config/redis';
import { RateLimitError } from './errorHandler';
import { logger } from '../utils/logger';

interface RateLimitConfig {
  windowMs: number;     // Time window in milliseconds
  maxRequests: number;  // Max requests per window
  keyPrefix: string;    // Redis key prefix
}

function createRateLimiter(config: RateLimitConfig) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const redis = getRedis();

      // Key: ip for unauthenticated, userId for authenticated
      const identifier = req.user?.userId || req.ip || 'unknown';
      const key = `${config.keyPrefix}:${identifier}`;

      const current = await redis.incr(key);

      // Set expiry on first request in window
      if (current === 1) {
        await redis.pexpire(key, config.windowMs);
      }

      if (current > config.maxRequests) {
        const ttl = await redis.pttl(key);
        const retryAfter = Math.ceil(ttl / 1000);

        logger.warn('Rate limit exceeded', {
          key: config.keyPrefix,
          identifier: identifier.substring(0, 20),
          requests: current,
          limit: config.maxRequests,
        });

        throw new RateLimitError(`Too many requests. Try again in ${retryAfter} seconds.`);
      }

      next();
    } catch (error) {
      if (error instanceof RateLimitError) return next(error);

      // If Redis is down, let the request through (fail open)
      logger.error('Rate limiter Redis error — allowing request', { error: (error as Error).message });
      next();
    }
  };
}

// ── Pre-configured limiters ─────────────────────────────────────────────────

// Global: 100 requests per minute per IP
export const globalRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 100,
  keyPrefix: 'rl:global',
});

// Auth endpoints: 10 requests per 10 minutes per IP (OTP abuse prevention)
export const authRateLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxRequests: 10,
  keyPrefix: 'rl:auth',
});

// OTP send: 3 per 10 minutes per IP (strict)
export const otpRateLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxRequests: 3,
  keyPrefix: 'rl:otp',
});

// Upload: 30 per minute per user
export const uploadRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 30,
  keyPrefix: 'rl:upload',
});

// Admin: 200 per minute (higher limit for dashboard polling)
export const adminRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 200,
  keyPrefix: 'rl:admin',
});
