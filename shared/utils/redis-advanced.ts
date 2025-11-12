import { createClient, RedisClientType } from 'redis';
import { createLogger } from './logger';

const logger = createLogger('redis-advanced');

/**
 * Advanced Redis Service with improved caching strategies
 * Implements: Cache-Aside, Write-Through, Cache Prefetching, and TTL strategies
 */
export class RedisAdvancedService {
  private client: RedisClientType;
  private replicaClient: RedisClientType | null = null;

  constructor(config?: {
    url?: string;
    replicaUrl?: string;
    socket?: {
      connectTimeout?: number;
      keepAlive?: number;
    };
  }) {
    // Primary client with connection pooling and socket optimization
    this.client = createClient({
      url: config?.url || process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        connectTimeout: config?.socket?.connectTimeout || 10000,
        keepAlive: config?.socket?.keepAlive || 30000,
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.error('Redis connection failed after 10 retries');
            return new Error('Max retries reached');
          }
          return Math.min(retries * 100, 3000);
        },
      },
      // Enable connection pooling
      isolationPoolOptions: {
        min: 2,
        max: 10,
      },
    });

    // Read replica for scaling reads
    if (config?.replicaUrl) {
      this.replicaClient = createClient({
        url: config.replicaUrl,
        socket: {
          connectTimeout: config?.socket?.connectTimeout || 10000,
          keepAlive: config?.socket?.keepAlive || 30000,
        },
      });
    }

    this.client.on('error', (err) => logger.error('Redis primary error', { error: err }));
    if (this.replicaClient) {
      this.replicaClient.on('error', (err) => logger.error('Redis replica error', { error: err }));
    }
  }

  async connect(): Promise<void> {
    await this.client.connect();
    if (this.replicaClient) {
      await this.replicaClient.connect();
    }
    logger.info('Redis connected successfully');
  }

  /**
   * Cache-Aside Pattern with automatic fallback
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number = 3600
  ): Promise<T> {
    try {
      // Try to read from replica if available, otherwise primary
      const readClient = this.replicaClient || this.client;
      const cached = await readClient.get(key);

      if (cached) {
        logger.debug('Cache hit', { key });
        return JSON.parse(cached);
      }

      logger.debug('Cache miss', { key });
      const data = await fetchFn();

      // Set in cache asynchronously (fire and forget)
      this.client.setEx(key, ttl, JSON.stringify(data)).catch((err) =>
        logger.error('Failed to cache data', { error: err, key })
      );

      return data;
    } catch (error) {
      logger.error('Cache-aside error', { error, key });
      // Fallback to fetching data on cache failure
      return await fetchFn();
    }
  }

  /**
   * Multi-get with pipeline optimization
   */
  async mGet<T>(keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();

    try {
      const readClient = this.replicaClient || this.client;
      const values = await readClient.mGet(keys);

      keys.forEach((key, index) => {
        if (values[index]) {
          try {
            result.set(key, JSON.parse(values[index]!));
          } catch (err) {
            logger.error('Failed to parse cached value', { key, error: err });
          }
        }
      });

      logger.debug('Multi-get completed', { total: keys.length, found: result.size });
    } catch (error) {
      logger.error('Multi-get failed', { error, keysCount: keys.length });
    }

    return result;
  }

  /**
   * Multi-set with pipeline optimization
   */
  async mSet(entries: Array<{ key: string; value: any; ttl?: number }>): Promise<void> {
    try {
      const pipeline = this.client.multi();

      entries.forEach(({ key, value, ttl = 3600 }) => {
        pipeline.setEx(key, ttl, JSON.stringify(value));
      });

      await pipeline.exec();
      logger.debug('Multi-set completed', { count: entries.length });
    } catch (error) {
      logger.error('Multi-set failed', { error, count: entries.length });
      throw error;
    }
  }

  /**
   * Write-Through Pattern: Update cache and database atomically
   */
  async writeThrough<T>(
    key: string,
    value: T,
    writeFn: (value: T) => Promise<void>,
    ttl: number = 3600
  ): Promise<void> {
    try {
      // Write to database first
      await writeFn(value);

      // Then update cache
      await this.client.setEx(key, ttl, JSON.stringify(value));
      logger.debug('Write-through completed', { key });
    } catch (error) {
      logger.error('Write-through failed', { error, key });
      // Invalidate cache on write failure
      await this.invalidate(key);
      throw error;
    }
  }

  /**
   * Cache Prefetching: Proactively load data
   */
  async prefetch(keys: Array<{ key: string; fetchFn: () => Promise<any>; ttl?: number }>): Promise<void> {
    try {
      const pipeline = this.client.multi();
      const results = await Promise.allSettled(keys.map(({ fetchFn }) => fetchFn()));

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const { key, ttl = 3600 } = keys[index];
          pipeline.setEx(key, ttl, JSON.stringify(result.value));
        }
      });

      await pipeline.exec();
      logger.info('Cache prefetch completed', { total: keys.length });
    } catch (error) {
      logger.error('Cache prefetch failed', { error });
    }
  }

  /**
   * Sliding Window Rate Limiting
   */
  async rateLimitSlidingWindow(
    key: string,
    maxRequests: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number }> {
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    try {
      const multi = this.client.multi();

      // Remove old entries
      multi.zRemRangeByScore(key, 0, windowStart);
      // Add current request
      multi.zAdd(key, { score: now, value: `${now}` });
      // Count requests in window
      multi.zCard(key);
      // Set expiry
      multi.expire(key, windowSeconds);

      const results = await multi.exec();
      const count = results[2] as number;

      const allowed = count <= maxRequests;
      const remaining = Math.max(0, maxRequests - count);

      logger.debug('Rate limit check', { key, count, allowed, remaining });

      return { allowed, remaining };
    } catch (error) {
      logger.error('Rate limit check failed', { error, key });
      return { allowed: true, remaining: maxRequests }; // Fail open
    }
  }

  /**
   * Distributed Lock with automatic expiration
   */
  async acquireLock(
    lockKey: string,
    ttl: number = 10,
    maxRetries: number = 3
  ): Promise<string | null> {
    const lockValue = `${Date.now()}-${Math.random()}`;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const acquired = await this.client.set(lockKey, lockValue, {
          NX: true,
          EX: ttl,
        });

        if (acquired) {
          logger.debug('Lock acquired', { lockKey, lockValue });
          return lockValue;
        }

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 100 * (i + 1)));
      } catch (error) {
        logger.error('Lock acquisition error', { error, lockKey, attempt: i + 1 });
      }
    }

    logger.warn('Failed to acquire lock', { lockKey, maxRetries });
    return null;
  }

  /**
   * Release distributed lock
   */
  async releaseLock(lockKey: string, lockValue: string): Promise<boolean> {
    try {
      // Lua script to ensure atomic check-and-delete
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;

      const result = await this.client.eval(script, {
        keys: [lockKey],
        arguments: [lockValue],
      });

      const released = result === 1;
      logger.debug('Lock release', { lockKey, released });
      return released;
    } catch (error) {
      logger.error('Lock release error', { error, lockKey });
      return false;
    }
  }

  /**
   * Invalidate cache with pattern matching
   */
  async invalidate(pattern: string): Promise<number> {
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length === 0) {
        return 0;
      }

      const deleted = await this.client.del(keys);
      logger.info('Cache invalidated', { pattern, deleted });
      return deleted;
    } catch (error) {
      logger.error('Cache invalidation failed', { error, pattern });
      return 0;
    }
  }

  /**
   * Cache statistics
   */
  async getStats(): Promise<{
    connectedClients: number;
    usedMemory: string;
    hits: number;
    misses: number;
    hitRate: number;
  }> {
    try {
      const info = await this.client.info('stats');
      const memory = await this.client.info('memory');

      // Parse info strings
      const stats = this.parseInfo(info);
      const memoryStats = this.parseInfo(memory);

      const hits = parseInt(stats.keyspace_hits || '0');
      const misses = parseInt(stats.keyspace_misses || '0');
      const total = hits + misses;
      const hitRate = total > 0 ? (hits / total) * 100 : 0;

      return {
        connectedClients: parseInt(stats.connected_clients || '0'),
        usedMemory: memoryStats.used_memory_human || '0B',
        hits,
        misses,
        hitRate: Math.round(hitRate * 100) / 100,
      };
    } catch (error) {
      logger.error('Failed to get stats', { error });
      return {
        connectedClients: 0,
        usedMemory: '0B',
        hits: 0,
        misses: 0,
        hitRate: 0,
      };
    }
  }

  private parseInfo(info: string): Record<string, string> {
    const result: Record<string, string> = {};
    info.split('\r\n').forEach((line) => {
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split(':');
        if (key && value) {
          result[key] = value;
        }
      }
    });
    return result;
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
    if (this.replicaClient) {
      await this.replicaClient.quit();
    }
    logger.info('Redis disconnected');
  }
}

export default RedisAdvancedService;
