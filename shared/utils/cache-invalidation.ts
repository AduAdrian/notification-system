import { RedisClientType } from 'redis';
import { createLogger } from './logger';
import { KafkaClient } from './kafka';

const logger = createLogger('cache-invalidation');

export interface InvalidationEvent {
  pattern?: string;
  keys?: string[];
  tags?: string[];
  timestamp: number;
}

/**
 * Cache Invalidation Manager
 * Handles pattern-based, tag-based, and event-driven cache invalidation
 */
export class CacheInvalidationManager {
  private redis: RedisClientType;
  private namespace: string;
  private kafka?: KafkaClient;
  private invalidationTopic: string;

  // Cache stampede prevention locks
  private lockPrefix = 'cache:lock:';
  private lockTTL = 10; // seconds

  constructor(
    redis: RedisClientType,
    config: {
      namespace?: string;
      kafka?: KafkaClient;
      invalidationTopic?: string;
    } = {}
  ) {
    this.redis = redis;
    this.namespace = config.namespace || 'cache';
    this.kafka = config.kafka;
    this.invalidationTopic = config.invalidationTopic || 'cache.invalidation';
  }

  /**
   * Invalidate cache by pattern (e.g., "user:*")
   * WARNING: KEYS command can be slow on large datasets
   * Consider using SCAN for production with large key spaces
   */
  async invalidateByPattern(pattern: string, useScan: boolean = true): Promise<number> {
    const fullPattern = `${this.namespace}:${pattern}`;
    let deleted = 0;

    try {
      if (useScan) {
        // Use SCAN for better performance
        deleted = await this.scanAndDelete(fullPattern);
      } else {
        // Use KEYS for smaller datasets
        const keys = await this.redis.keys(fullPattern);
        if (keys.length > 0) {
          deleted = await this.redis.del(keys);
        }
      }

      logger.info('Pattern invalidation completed', { pattern: fullPattern, deleted });

      // Broadcast invalidation event
      await this.broadcastInvalidation({ pattern: fullPattern, timestamp: Date.now() });

      return deleted;
    } catch (error) {
      logger.error('Pattern invalidation error', { error, pattern: fullPattern });
      return 0;
    }
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags: string[]): Promise<number> {
    let totalDeleted = 0;

    try {
      for (const tag of tags) {
        const tagKey = `${this.namespace}:tag:${tag}`;

        // Get all keys with this tag
        const keys = await this.redis.sMembers(tagKey);

        if (keys.length > 0) {
          // Delete all tagged keys
          const deleted = await this.redis.del(keys);
          totalDeleted += deleted;

          // Remove tag set
          await this.redis.del(tagKey);
        }
      }

      logger.info('Tag invalidation completed', { tags, deleted: totalDeleted });

      // Broadcast invalidation event
      await this.broadcastInvalidation({ tags, timestamp: Date.now() });

      return totalDeleted;
    } catch (error) {
      logger.error('Tag invalidation error', { error, tags });
      return 0;
    }
  }

  /**
   * Invalidate specific keys
   */
  async invalidateKeys(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;

    const fullKeys = keys.map((k) => `${this.namespace}:${k}`);

    try {
      const deleted = await this.redis.del(fullKeys);
      logger.info('Key invalidation completed', { keys: fullKeys.length, deleted });

      // Broadcast invalidation event
      await this.broadcastInvalidation({ keys: fullKeys, timestamp: Date.now() });

      return deleted;
    } catch (error) {
      logger.error('Key invalidation error', { error, keysCount: keys.length });
      return 0;
    }
  }

  /**
   * Invalidate all cache in namespace
   * USE WITH CAUTION!
   */
  async invalidateAll(): Promise<number> {
    return await this.invalidateByPattern('*', true);
  }

  /**
   * Cache stampede prevention with distributed locking
   * Prevents multiple processes from loading same data simultaneously
   */
  async withStampedePrevention<T>(
    key: string,
    dataLoader: () => Promise<T>,
    options: {
      lockTimeout?: number;
      retryDelay?: number;
      maxRetries?: number;
    } = {}
  ): Promise<T> {
    const lockKey = `${this.lockPrefix}${this.namespace}:${key}`;
    const lockTimeout = options.lockTimeout || this.lockTTL;
    const retryDelay = options.retryDelay || 100;
    const maxRetries = options.maxRetries || 10;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Try to acquire lock
      const lockValue = `${Date.now()}-${Math.random()}`;
      const acquired = await this.redis.set(lockKey, lockValue, {
        NX: true,
        EX: lockTimeout,
      });

      if (acquired) {
        try {
          logger.debug('Lock acquired for cache loading', { key, attempt });

          // Load data with lock held
          const data = await dataLoader();

          return data;
        } finally {
          // Release lock using Lua script for atomicity
          await this.releaseLock(lockKey, lockValue);
        }
      }

      // Lock not acquired, wait and retry
      logger.debug('Lock not acquired, retrying', { key, attempt });
      await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
    }

    // Max retries exceeded, proceed without lock (fail-safe)
    logger.warn('Max lock retries exceeded, loading without lock', { key });
    return await dataLoader();
  }

  /**
   * Refresh cache proactively before expiration (cache warming)
   */
  async refreshCache<T>(
    key: string,
    dataLoader: () => Promise<T>,
    ttl: number,
    refreshThreshold: number = 0.8 // Refresh when 80% of TTL elapsed
  ): Promise<T | null> {
    const fullKey = `${this.namespace}:${key}`;

    try {
      // Check if key exists and its TTL
      const currentTTL = await this.redis.ttl(fullKey);

      if (currentTTL < 0) {
        // Key doesn't exist or has no expiry
        return null;
      }

      const timeElapsed = ttl - currentTTL;
      const shouldRefresh = timeElapsed / ttl >= refreshThreshold;

      if (shouldRefresh) {
        logger.debug('Proactive cache refresh triggered', { key, currentTTL, ttl });

        // Refresh in background (don't block)
        this.withStampedePrevention(key, async () => {
          const data = await dataLoader();
          await this.redis.setEx(fullKey, ttl, JSON.stringify(data));
          logger.debug('Cache refreshed proactively', { key });
          return data;
        }).catch((err) => logger.error('Background refresh failed', { error: err, key }));
      }

      return null;
    } catch (error) {
      logger.error('Cache refresh error', { error, key });
      return null;
    }
  }

  /**
   * Listen to Kafka events for cache invalidation
   */
  async subscribeToInvalidationEvents(
    handler?: (event: InvalidationEvent) => Promise<void>
  ): Promise<void> {
    if (!this.kafka) {
      logger.warn('Kafka not configured, skipping event subscription');
      return;
    }

    try {
      await this.kafka.subscribe([this.invalidationTopic], async (message) => {
        try {
          const event: InvalidationEvent = JSON.parse(message.value?.toString() || '{}');

          logger.info('Received invalidation event', {
            pattern: event.pattern,
            tags: event.tags,
            keysCount: event.keys?.length,
          });

          // Handle invalidation
          if (event.pattern) {
            await this.invalidateByPattern(event.pattern);
          }
          if (event.tags) {
            await this.invalidateByTags(event.tags);
          }
          if (event.keys) {
            await this.invalidateKeys(event.keys);
          }

          // Custom handler
          if (handler) {
            await handler(event);
          }
        } catch (error) {
          logger.error('Failed to process invalidation event', { error, message });
        }
      });

      logger.info('Subscribed to invalidation events', { topic: this.invalidationTopic });
    } catch (error) {
      logger.error('Failed to subscribe to invalidation events', { error });
      throw error;
    }
  }

  /**
   * Broadcast invalidation event to other instances via Kafka
   */
  private async broadcastInvalidation(event: InvalidationEvent): Promise<void> {
    if (!this.kafka) return;

    try {
      await this.kafka.produce({
        topic: this.invalidationTopic,
        messages: [
          {
            value: JSON.stringify(event),
            timestamp: Date.now().toString(),
          },
        ],
      });

      logger.debug('Invalidation event broadcast', { event });
    } catch (error) {
      logger.error('Failed to broadcast invalidation event', { error, event });
    }
  }

  /**
   * Scan and delete keys matching pattern (more efficient than KEYS)
   */
  private async scanAndDelete(pattern: string): Promise<number> {
    let cursor = 0;
    let deleted = 0;
    const batchSize = 100;

    do {
      try {
        const result = await this.redis.scan(cursor, {
          MATCH: pattern,
          COUNT: batchSize,
        });

        cursor = result.cursor;
        const keys = result.keys;

        if (keys.length > 0) {
          deleted += await this.redis.del(keys);
        }
      } catch (error) {
        logger.error('Scan and delete error', { error, pattern, cursor });
        break;
      }
    } while (cursor !== 0);

    return deleted;
  }

  /**
   * Release distributed lock atomically
   */
  private async releaseLock(lockKey: string, lockValue: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    try {
      const result = await this.redis.eval(script, {
        keys: [lockKey],
        arguments: [lockValue],
      });

      return result === 1;
    } catch (error) {
      logger.error('Lock release error', { error, lockKey });
      return false;
    }
  }
}

/**
 * Time-based cache invalidation
 */
export class TimedInvalidationScheduler {
  private redis: RedisClientType;
  private schedules: Map<string, NodeJS.Timeout> = new Map();

  constructor(redis: RedisClientType) {
    this.redis = redis;
  }

  /**
   * Schedule periodic invalidation
   */
  schedule(
    name: string,
    pattern: string,
    intervalMs: number,
    invalidationManager: CacheInvalidationManager
  ): void {
    // Clear existing schedule
    this.cancel(name);

    const task = setInterval(async () => {
      try {
        logger.info('Running scheduled invalidation', { name, pattern });
        await invalidationManager.invalidateByPattern(pattern);
      } catch (error) {
        logger.error('Scheduled invalidation error', { error, name, pattern });
      }
    }, intervalMs);

    this.schedules.set(name, task);
    logger.info('Scheduled invalidation task', { name, pattern, intervalMs });
  }

  /**
   * Schedule invalidation at specific time
   */
  scheduleAt(
    name: string,
    pattern: string,
    datetime: Date,
    invalidationManager: CacheInvalidationManager
  ): void {
    const now = Date.now();
    const targetTime = datetime.getTime();
    const delay = targetTime - now;

    if (delay <= 0) {
      logger.warn('Scheduled time is in the past', { name, datetime });
      return;
    }

    // Clear existing schedule
    this.cancel(name);

    const task = setTimeout(async () => {
      try {
        logger.info('Running scheduled invalidation', { name, pattern, datetime });
        await invalidationManager.invalidateByPattern(pattern);
        this.schedules.delete(name);
      } catch (error) {
        logger.error('Scheduled invalidation error', { error, name, pattern });
      }
    }, delay);

    this.schedules.set(name, task);
    logger.info('Scheduled one-time invalidation', { name, pattern, datetime });
  }

  /**
   * Cancel scheduled invalidation
   */
  cancel(name: string): void {
    const task = this.schedules.get(name);
    if (task) {
      clearTimeout(task);
      clearInterval(task);
      this.schedules.delete(name);
      logger.info('Cancelled scheduled invalidation', { name });
    }
  }

  /**
   * Cancel all scheduled tasks
   */
  cancelAll(): void {
    this.schedules.forEach((task, name) => {
      clearTimeout(task);
      clearInterval(task);
      logger.info('Cancelled scheduled invalidation', { name });
    });
    this.schedules.clear();
  }
}
