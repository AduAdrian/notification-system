import { Request, Response, NextFunction } from 'express';
import { TokenBucketLimiter, RateLimitResult } from '../rate-limiter';
import { RedisClientType } from 'redis';
import { createLogger } from '../logger';

const logger = createLogger('rate-limit-middleware');

export interface RateLimitConfig {
  capacity: number;
  refillRate: number;
  keyPrefix?: string;
  identifierExtractor?: (req: Request) => string | string[];
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  skip?: (req: Request) => boolean;
  onLimitReached?: (req: Request, res: Response) => void;
}

/**
 * Rate Limit Middleware Factory
 * Creates Express middleware using token bucket algorithm
 */
export function createRateLimitMiddleware(
  redis: RedisClientType,
  config: RateLimitConfig
) {
  const limiter = new TokenBucketLimiter({
    capacity: config.capacity,
    refillRate: config.refillRate,
    redisClient: redis,
  });

  const keyPrefix = config.keyPrefix || 'global';

  // Default identifier extractor: use userId > apiKey > IP
  const extractIdentifier = config.identifierExtractor || ((req: Request) => {
    const user = (req as any).user;
    if (user?.userId) return `user:${user.userId}`;

    const apiKey = req.headers['x-api-key'] as string;
    if (apiKey) return `apikey:${apiKey}`;

    return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  });

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Skip if configured
      if (config.skip && config.skip(req)) {
        return next();
      }

      // Extract identifier(s)
      const rawIdentifier = extractIdentifier(req);
      const identifiers = Array.isArray(rawIdentifier) ? rawIdentifier : [rawIdentifier];

      // Build full keys
      const fullKeys = identifiers.map((id) => `${keyPrefix}:${id}`);

      // Check rate limit for first identifier (can be extended for multiple)
      const result = await limiter.check(fullKeys[0]);

      // Set rate limit headers
      setRateLimitHeaders(res, result, config);

      if (!result.allowed) {
        logger.warn('Rate limit exceeded', {
          identifier: fullKeys[0],
          remaining: result.remaining,
          resetAt: result.resetAt,
          path: req.path,
          method: req.method,
        });

        if (config.onLimitReached) {
          config.onLimitReached(req, res);
        }

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

      // Store result for response handling
      (req as any).rateLimit = result;

      next();
    } catch (error) {
      logger.error('Rate limit middleware error', { error, path: req.path });
      // Fail open: allow request if rate limiting fails
      next();
    }
  };
}

/**
 * Set standard rate limit headers
 */
function setRateLimitHeaders(res: Response, result: RateLimitResult, config: RateLimitConfig) {
  res.set({
    'X-RateLimit-Limit': config.capacity.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': result.resetAt.toISOString(),
  });

  if (!result.allowed && result.retryAfter) {
    res.set('Retry-After', Math.ceil(result.retryAfter).toString());
  }
}

/**
 * Pre-configured rate limit middleware for common use cases
 */
export class RateLimitMiddlewares {
  private redis: RedisClientType;

  constructor(redis: RedisClientType) {
    this.redis = redis;
  }

  /**
   * Strict rate limit for authentication endpoints
   * 5 requests per minute per IP
   */
  auth() {
    return createRateLimitMiddleware(this.redis, {
      capacity: 5,
      refillRate: 5 / 60, // 5 per minute
      keyPrefix: 'auth',
      identifierExtractor: (req) => `ip:${req.ip || 'unknown'}`,
    });
  }

  /**
   * Standard API rate limit
   * 100 requests per minute per user
   */
  api() {
    return createRateLimitMiddleware(this.redis, {
      capacity: 100,
      refillRate: 100 / 60, // 100 per minute
      keyPrefix: 'api',
    });
  }

  /**
   * Generous rate limit for authenticated users
   * 1000 requests per hour per user
   */
  authenticated() {
    return createRateLimitMiddleware(this.redis, {
      capacity: 1000,
      refillRate: 1000 / 3600, // 1000 per hour
      keyPrefix: 'authenticated',
      identifierExtractor: (req) => {
        const user = (req as any).user;
        return user?.userId ? `user:${user.userId}` : `ip:${req.ip || 'unknown'}`;
      },
    });
  }

  /**
   * Strict rate limit for expensive operations
   * 10 requests per minute per user
   */
  expensive() {
    return createRateLimitMiddleware(this.redis, {
      capacity: 10,
      refillRate: 10 / 60, // 10 per minute
      keyPrefix: 'expensive',
    });
  }

  /**
   * API key based rate limit
   * Custom limits based on API key tier
   */
  apiKey(config: { capacity: number; refillRate: number }) {
    return createRateLimitMiddleware(this.redis, {
      capacity: config.capacity,
      refillRate: config.refillRate,
      keyPrefix: 'apikey',
      identifierExtractor: (req) => {
        const apiKey = req.headers['x-api-key'] as string;
        return apiKey ? `apikey:${apiKey}` : `ip:${req.ip || 'unknown'}`;
      },
    });
  }

  /**
   * Per-endpoint rate limit
   * Different limits for different endpoints
   */
  perEndpoint(limits: Record<string, { capacity: number; refillRate: number }>) {
    return (req: Request, res: Response, next: NextFunction) => {
      const endpoint = req.path;
      const config = limits[endpoint];

      if (!config) {
        return next();
      }

      const middleware = createRateLimitMiddleware(this.redis, {
        capacity: config.capacity,
        refillRate: config.refillRate,
        keyPrefix: `endpoint:${endpoint}`,
      });

      return middleware(req, res, next);
    };
  }

  /**
   * Combined rate limit (user + IP)
   * Both limits must pass
   */
  combined(userConfig: RateLimitConfig, ipConfig: RateLimitConfig) {
    const userLimiter = new TokenBucketLimiter({
      capacity: userConfig.capacity,
      refillRate: userConfig.refillRate,
      redisClient: this.redis,
    });

    const ipLimiter = new TokenBucketLimiter({
      capacity: ipConfig.capacity,
      refillRate: ipConfig.refillRate,
      redisClient: this.redis,
    });

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const user = (req as any).user;
        const userId = user?.userId;
        const ip = req.ip || 'unknown';

        // Check both limits
        const [userResult, ipResult] = await Promise.all([
          userId ? userLimiter.check(`user:${userId}`) : Promise.resolve({ allowed: true, remaining: 0, resetAt: new Date() }),
          ipLimiter.check(`ip:${ip}`),
        ]);

        // Use stricter limit
        const result = userResult.allowed && ipResult.allowed
          ? (userResult.remaining < ipResult.remaining ? userResult : ipResult)
          : (!userResult.allowed ? userResult : ipResult);

        setRateLimitHeaders(res, result, userConfig);

        if (!result.allowed) {
          logger.warn('Combined rate limit exceeded', {
            userId,
            ip,
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
        logger.error('Combined rate limit error', { error });
        next();
      }
    };
  }
}

/**
 * Helper to create metrics-aware rate limit middleware
 */
export function createMetricsAwareRateLimitMiddleware(
  redis: RedisClientType,
  config: RateLimitConfig,
  metrics: any
) {
  const baseMiddleware = createRateLimitMiddleware(redis, config);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const start = Date.now();

    await baseMiddleware(req, res, (err?: any) => {
      const duration = (Date.now() - start) / 1000;
      const allowed = res.statusCode !== 429;

      // Record metrics
      if (metrics?.rateLimitRequestsTotal) {
        metrics.rateLimitRequestsTotal.inc({ allowed: allowed.toString() });
      }

      if (metrics?.rateLimitDuration) {
        metrics.rateLimitDuration.observe(duration);
      }

      if ((req as any).rateLimit && metrics?.rateLimitTokensRemaining) {
        metrics.rateLimitTokensRemaining.set((req as any).rateLimit.remaining);
      }

      if (err) return next(err);
      next();
    });
  };
}
