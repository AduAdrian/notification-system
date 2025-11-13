import { Request, Response, NextFunction } from 'express';
import { createLogger } from '@notification-system/utils';
import { TokenBucketLimiter } from '@notification-system/utils/rate-limiter';
import {
  rateLimitRequestsTotal,
  rateLimitTokensRemaining,
  rateLimitCheckDuration,
} from '@notification-system/utils/cache-metrics';

const logger = createLogger('ratelimit-middleware');

// Initialize rate limiter lazily
let limiter: TokenBucketLimiter | null = null;

function initLimiter(redisClient: any) {
  if (!limiter) {
    const capacity = parseInt(process.env.RATE_LIMIT_CAPACITY || '100');
    const refillRate = parseInt(process.env.RATE_LIMIT_REFILL_RATE || '10');

    limiter = new TokenBucketLimiter({
      capacity,
      refillRate,
      redisClient,
      burstMultiplier: parseFloat(process.env.RATE_LIMIT_BURST_MULTIPLIER || '1.5'),
    });

    logger.info('Token bucket limiter initialized', { capacity, refillRate });
  }
  return limiter;
}

export const rateLimiter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const startTime = Date.now();

  try {
    const { redisService } = req.app.locals;
    const redis = redisService.getClient();

    const rateLimiter = initLimiter(redis);

    // Extract identifier: user > apikey > ip
    const user = (req as any).user;
    const userId = user?.userId;
    const apiKey = req.headers['x-api-key'] as string;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    let identifier: string;
    let identifierType: string;

    if (userId) {
      identifier = `user:${userId}`;
      identifierType = 'user';
    } else if (apiKey) {
      identifier = `apikey:${apiKey}`;
      identifierType = 'apikey';
    } else {
      identifier = `ip:${ip}`;
      identifierType = 'ip';
    }

    // Check rate limit
    const result = await rateLimiter.check(identifier);

    // Record metrics
    const duration = (Date.now() - startTime) / 1000;
    rateLimitRequestsTotal.inc({
      allowed: result.allowed.toString(),
      identifier_type: identifierType,
    });
    rateLimitCheckDuration.observe({ identifier_type: identifierType }, duration);

    if (result.allowed) {
      rateLimitTokensRemaining.set({ identifier }, result.remaining);
    }

    // Set rate limit headers
    res.set({
      'X-RateLimit-Limit': rateLimiter.getConfig().capacity.toString(),
      'X-RateLimit-Remaining': result.remaining.toString(),
      'X-RateLimit-Reset': result.resetAt.toISOString(),
    });

    if (!result.allowed) {
      if (result.retryAfter) {
        res.set('Retry-After', Math.ceil(result.retryAfter).toString());
      }

      logger.warn('Rate limit exceeded', {
        identifier,
        identifierType,
        remaining: result.remaining,
        resetAt: result.resetAt,
        path: req.path,
      });

      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please try again later',
          retryAfter: result.retryAfter,
          resetAt: result.resetAt.toISOString(),
        },
      });
      return;
    }

    next();
  } catch (error) {
    logger.error('Rate limit check failed', { error });
    // Fail open: allow request if rate limiting fails
    next();
  }
};
