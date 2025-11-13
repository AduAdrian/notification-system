import { RedisClientType } from 'redis';
import { createLogger } from './logger';

const logger = createLogger('rate-limiter');

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfter?: number;
}

export interface TokenBucketConfig {
  capacity: number;
  refillRate: number;
  redisClient: RedisClientType;
  burstMultiplier?: number;
}

/**
 * Token Bucket Rate Limiter
 * Implements token bucket algorithm with Redis + Lua scripts for atomic operations
 * Supports distributed rate limiting across multiple instances
 *
 * Algorithm:
 * - Each identifier has a bucket with fixed capacity
 * - Tokens refill at constant rate
 * - Requests consume tokens
 * - Burst allowance via burstMultiplier
 */
export class TokenBucketLimiter {
  private capacity: number;
  private refillRate: number;
  private redis: RedisClientType;
  private burstMultiplier: number;

  // Lua script for atomic token bucket operations
  private static readonly LUA_SCRIPT = `
    local key = KEYS[1]
    local capacity = tonumber(ARGV[1])
    local refill_rate = tonumber(ARGV[2])
    local now = tonumber(ARGV[3])
    local requested = tonumber(ARGV[4])

    local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
    local tokens = tonumber(bucket[1])
    local last_refill = tonumber(bucket[2])

    -- Initialize bucket if doesn't exist
    if tokens == nil then
      tokens = capacity
      last_refill = now
    end

    -- Calculate tokens to add based on time elapsed
    local time_elapsed = now - last_refill
    local tokens_to_add = time_elapsed * refill_rate
    tokens = math.min(capacity, tokens + tokens_to_add)

    -- Check if request can be satisfied
    local allowed = 0
    if tokens >= requested then
      tokens = tokens - requested
      allowed = 1
    end

    -- Update bucket
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
    redis.call('EXPIRE', key, 3600)

    -- Calculate reset time (when bucket will be full)
    local tokens_needed = capacity - tokens
    local reset_seconds = math.ceil(tokens_needed / refill_rate)

    return {allowed, math.floor(tokens), reset_seconds}
  `;

  constructor(config: TokenBucketConfig) {
    this.capacity = config.capacity;
    this.refillRate = config.refillRate;
    this.redis = config.redisClient;
    this.burstMultiplier = config.burstMultiplier || 1.0;
  }

  /**
   * Check rate limit for given identifier
   * @param identifier - Unique identifier (user:123, ip:1.2.3.4, apikey:abc)
   * @param cost - Number of tokens to consume (default: 1)
   */
  async check(identifier: string, cost: number = 1): Promise<RateLimitResult> {
    const key = `ratelimit:tokenbucket:${identifier}`;
    const now = Date.now() / 1000; // Convert to seconds

    try {
      const result = await this.redis.eval(TokenBucketLimiter.LUA_SCRIPT, {
        keys: [key],
        arguments: [
          this.capacity.toString(),
          this.refillRate.toString(),
          now.toString(),
          cost.toString(),
        ],
      }) as number[];

      const [allowed, remaining, resetSeconds] = result;
      const resetAt = new Date(Date.now() + resetSeconds * 1000);

      const rateLimitResult: RateLimitResult = {
        allowed: allowed === 1,
        remaining: Math.max(0, remaining),
        resetAt,
      };

      if (!rateLimitResult.allowed) {
        rateLimitResult.retryAfter = resetSeconds;
      }

      logger.debug('Rate limit check', {
        identifier,
        allowed: rateLimitResult.allowed,
        remaining: rateLimitResult.remaining,
        resetAt: rateLimitResult.resetAt,
      });

      return rateLimitResult;
    } catch (error) {
      logger.error('Rate limit check failed', { error, identifier });
      // Fail open: allow request if Redis is down
      return {
        allowed: true,
        remaining: this.capacity,
        resetAt: new Date(Date.now() + 3600000),
      };
    }
  }

  /**
   * Check multiple identifiers at once (e.g., per-user + per-IP)
   */
  async checkMultiple(
    identifiers: Array<{ id: string; cost?: number }>,
    mode: 'all' | 'any' = 'all'
  ): Promise<RateLimitResult> {
    const results = await Promise.all(
      identifiers.map(({ id, cost }) => this.check(id, cost))
    );

    if (mode === 'all') {
      // All must pass
      const allAllowed = results.every((r) => r.allowed);
      const minRemaining = Math.min(...results.map((r) => r.remaining));
      const earliestReset = new Date(Math.min(...results.map((r) => r.resetAt.getTime())));

      return {
        allowed: allAllowed,
        remaining: minRemaining,
        resetAt: earliestReset,
        retryAfter: allAllowed ? undefined : Math.max(...results.map((r) => r.retryAfter || 0)),
      };
    } else {
      // Any can pass
      const anyAllowed = results.some((r) => r.allowed);
      const maxRemaining = Math.max(...results.map((r) => r.remaining));
      const latestReset = new Date(Math.max(...results.map((r) => r.resetAt.getTime())));

      return {
        allowed: anyAllowed,
        remaining: maxRemaining,
        resetAt: latestReset,
      };
    }
  }

  /**
   * Get current bucket state without consuming tokens
   */
  async peek(identifier: string): Promise<{ tokens: number; resetAt: Date }> {
    const key = `ratelimit:tokenbucket:${identifier}`;
    const now = Date.now() / 1000;

    try {
      const bucket = await this.redis.hmGet(key, ['tokens', 'last_refill']);
      let tokens = parseFloat(bucket[0] || this.capacity.toString());
      const lastRefill = parseFloat(bucket[1] || now.toString());

      // Calculate current tokens with refill
      const timeElapsed = now - lastRefill;
      const tokensToAdd = timeElapsed * this.refillRate;
      tokens = Math.min(this.capacity, tokens + tokensToAdd);

      const tokensNeeded = this.capacity - tokens;
      const resetSeconds = Math.ceil(tokensNeeded / this.refillRate);
      const resetAt = new Date(Date.now() + resetSeconds * 1000);

      return { tokens: Math.floor(tokens), resetAt };
    } catch (error) {
      logger.error('Peek failed', { error, identifier });
      return { tokens: this.capacity, resetAt: new Date(Date.now() + 3600000) };
    }
  }

  /**
   * Reset bucket for identifier (admin/testing)
   */
  async reset(identifier: string): Promise<void> {
    const key = `ratelimit:tokenbucket:${identifier}`;
    try {
      await this.redis.del(key);
      logger.info('Rate limit reset', { identifier });
    } catch (error) {
      logger.error('Reset failed', { error, identifier });
    }
  }

  /**
   * Get configuration
   */
  getConfig(): { capacity: number; refillRate: number; burstMultiplier: number } {
    return {
      capacity: this.capacity,
      refillRate: this.refillRate,
      burstMultiplier: this.burstMultiplier,
    };
  }
}

/**
 * Fixed Window Rate Limiter (simpler alternative)
 */
export class FixedWindowLimiter {
  private maxRequests: number;
  private windowSeconds: number;
  private redis: RedisClientType;

  private static readonly LUA_SCRIPT = `
    local key = KEYS[1]
    local max_requests = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])

    local count = redis.call('INCR', key)

    if count == 1 then
      redis.call('EXPIRE', key, window)
    end

    local ttl = redis.call('TTL', key)
    local allowed = count <= max_requests

    return {allowed and 1 or 0, max_requests - count, ttl}
  `;

  constructor(maxRequests: number, windowSeconds: number, redisClient: RedisClientType) {
    this.maxRequests = maxRequests;
    this.windowSeconds = windowSeconds;
    this.redis = redisClient;
  }

  async check(identifier: string): Promise<RateLimitResult> {
    const key = `ratelimit:fixedwindow:${identifier}`;

    try {
      const result = await this.redis.eval(FixedWindowLimiter.LUA_SCRIPT, {
        keys: [key],
        arguments: [this.maxRequests.toString(), this.windowSeconds.toString()],
      }) as number[];

      const [allowed, remaining, ttl] = result;
      const resetAt = new Date(Date.now() + ttl * 1000);

      return {
        allowed: allowed === 1,
        remaining: Math.max(0, remaining),
        resetAt,
        retryAfter: allowed === 0 ? ttl : undefined,
      };
    } catch (error) {
      logger.error('Fixed window check failed', { error, identifier });
      return {
        allowed: true,
        remaining: this.maxRequests,
        resetAt: new Date(Date.now() + this.windowSeconds * 1000),
      };
    }
  }
}

/**
 * Sliding Window Rate Limiter (more accurate)
 */
export class SlidingWindowLimiter {
  private maxRequests: number;
  private windowSeconds: number;
  private redis: RedisClientType;

  private static readonly LUA_SCRIPT = `
    local key = KEYS[1]
    local max_requests = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])
    local now = tonumber(ARGV[3])

    local window_start = now - window

    -- Remove old entries
    redis.call('ZREMRANGEBYSCORE', key, 0, window_start)

    -- Count current requests
    local count = redis.call('ZCARD', key)

    local allowed = 0
    if count < max_requests then
      redis.call('ZADD', key, now, now)
      allowed = 1
      count = count + 1
    end

    redis.call('EXPIRE', key, window)

    return {allowed, max_requests - count, window}
  `;

  constructor(maxRequests: number, windowSeconds: number, redisClient: RedisClientType) {
    this.maxRequests = maxRequests;
    this.windowSeconds = windowSeconds;
    this.redis = redisClient;
  }

  async check(identifier: string): Promise<RateLimitResult> {
    const key = `ratelimit:slidingwindow:${identifier}`;
    const now = Date.now() / 1000;

    try {
      const result = await this.redis.eval(SlidingWindowLimiter.LUA_SCRIPT, {
        keys: [key],
        arguments: [this.maxRequests.toString(), this.windowSeconds.toString(), now.toString()],
      }) as number[];

      const [allowed, remaining, resetSeconds] = result;
      const resetAt = new Date(Date.now() + resetSeconds * 1000);

      return {
        allowed: allowed === 1,
        remaining: Math.max(0, remaining),
        resetAt,
        retryAfter: allowed === 0 ? resetSeconds : undefined,
      };
    } catch (error) {
      logger.error('Sliding window check failed', { error, identifier });
      return {
        allowed: true,
        remaining: this.maxRequests,
        resetAt: new Date(Date.now() + this.windowSeconds * 1000),
      };
    }
  }
}
