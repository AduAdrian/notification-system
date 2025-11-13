import { RedisClientType } from 'redis';
import { createLogger } from './logger';

const logger = createLogger('cache-strategies');

export interface CacheOptions {
  ttl?: number;
  tags?: string[];
  namespace?: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  hitRate: number;
}

/**
 * Base Cache Strategy
 */
abstract class BaseCacheStrategy {
  protected redis: RedisClientType;
  protected namespace: string;
  protected stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    hitRate: 0,
  };

  constructor(redis: RedisClientType, namespace: string = 'cache') {
    this.redis = redis;
    this.namespace = namespace;
  }

  protected buildKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  protected updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = { hits: 0, misses: 0, sets: 0, deletes: 0, hitRate: 0 };
  }
}

/**
 * Cache-Aside (Lazy Loading) Strategy
 * Best for: Read-heavy workloads, data that changes infrequently
 *
 * Application checks cache first, on miss loads from DB and caches result
 */
export class CacheAsideStrategy extends BaseCacheStrategy {
  constructor(redis: RedisClientType, namespace: string = 'cache-aside') {
    super(redis, namespace);
  }

  /**
   * Get data with automatic fallback to data source
   */
  async get<T>(
    key: string,
    dataSource: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const fullKey = this.buildKey(key);
    const ttl = options.ttl || 3600;

    try {
      // Try cache first
      const cached = await this.redis.get(fullKey);

      if (cached) {
        this.stats.hits++;
        this.updateHitRate();
        logger.debug('Cache hit', { key: fullKey });
        return JSON.parse(cached);
      }

      // Cache miss - load from data source
      this.stats.misses++;
      this.updateHitRate();
      logger.debug('Cache miss', { key: fullKey });

      const data = await dataSource();

      // Store in cache (fire and forget)
      this.set(key, data, options).catch((err) =>
        logger.error('Failed to cache data', { error: err, key: fullKey })
      );

      return data;
    } catch (error) {
      logger.error('Cache-aside get error', { error, key: fullKey });
      // Fallback to data source on cache failure
      return await dataSource();
    }
  }

  /**
   * Set data in cache
   */
  async set<T>(key: string, data: T, options: CacheOptions = {}): Promise<void> {
    const fullKey = this.buildKey(key);
    const ttl = options.ttl || 3600;

    try {
      await this.redis.setEx(fullKey, ttl, JSON.stringify(data));

      // Store tags for invalidation
      if (options.tags) {
        await this.storeTags(fullKey, options.tags);
      }

      this.stats.sets++;
      logger.debug('Cache set', { key: fullKey, ttl });
    } catch (error) {
      logger.error('Cache set error', { error, key: fullKey });
    }
  }

  /**
   * Delete from cache
   */
  async delete(key: string): Promise<void> {
    const fullKey = this.buildKey(key);

    try {
      await this.redis.del(fullKey);
      this.stats.deletes++;
      logger.debug('Cache deleted', { key: fullKey });
    } catch (error) {
      logger.error('Cache delete error', { error, key: fullKey });
    }
  }

  /**
   * Get multiple keys with batch optimization
   */
  async getMany<T>(
    keys: string[],
    dataSource: (missingKeys: string[]) => Promise<Map<string, T>>,
    options: CacheOptions = {}
  ): Promise<Map<string, T>> {
    const fullKeys = keys.map((k) => this.buildKey(k));
    const result = new Map<string, T>();

    try {
      // Try to get all from cache
      const cached = await this.redis.mGet(fullKeys);

      const missingKeys: string[] = [];
      keys.forEach((key, index) => {
        if (cached[index]) {
          try {
            result.set(key, JSON.parse(cached[index]!));
            this.stats.hits++;
          } catch (err) {
            logger.error('Failed to parse cached value', { key, error: err });
            missingKeys.push(key);
          }
        } else {
          missingKeys.push(key);
          this.stats.misses++;
        }
      });

      this.updateHitRate();

      // Load missing keys from data source
      if (missingKeys.length > 0) {
        const freshData = await dataSource(missingKeys);

        // Cache the fresh data
        const pipeline = this.redis.multi();
        freshData.forEach((value, key) => {
          result.set(key, value);
          const fullKey = this.buildKey(key);
          pipeline.setEx(fullKey, options.ttl || 3600, JSON.stringify(value));
        });
        await pipeline.exec();
        this.stats.sets += missingKeys.length;
      }

      return result;
    } catch (error) {
      logger.error('Cache-aside getMany error', { error, keysCount: keys.length });
      return await dataSource(keys);
    }
  }

  private async storeTags(key: string, tags: string[]): Promise<void> {
    const pipeline = this.redis.multi();
    tags.forEach((tag) => {
      const tagKey = `${this.namespace}:tag:${tag}`;
      pipeline.sAdd(tagKey, key);
      pipeline.expire(tagKey, 86400); // 24 hours
    });
    await pipeline.exec();
  }
}

/**
 * Write-Through Strategy
 * Best for: Consistency-critical data, write-heavy workloads
 *
 * Updates cache and database synchronously
 */
export class WriteThroughStrategy extends BaseCacheStrategy {
  constructor(redis: RedisClientType, namespace: string = 'write-through') {
    super(redis, namespace);
  }

  /**
   * Write data to both cache and data source
   */
  async set<T>(
    key: string,
    data: T,
    dataSource: (data: T) => Promise<void>,
    options: CacheOptions = {}
  ): Promise<void> {
    const fullKey = this.buildKey(key);
    const ttl = options.ttl || 3600;

    try {
      // Write to data source first (more important)
      await dataSource(data);

      // Then update cache
      await this.redis.setEx(fullKey, ttl, JSON.stringify(data));

      if (options.tags) {
        await this.storeTags(fullKey, options.tags);
      }

      this.stats.sets++;
      logger.debug('Write-through completed', { key: fullKey });
    } catch (error) {
      logger.error('Write-through error', { error, key: fullKey });
      // Invalidate cache on write failure
      await this.redis.del(fullKey).catch(() => {});
      throw error;
    }
  }

  /**
   * Read with fallback
   */
  async get<T>(key: string, dataSource: () => Promise<T>): Promise<T> {
    const fullKey = this.buildKey(key);

    try {
      const cached = await this.redis.get(fullKey);

      if (cached) {
        this.stats.hits++;
        this.updateHitRate();
        return JSON.parse(cached);
      }

      this.stats.misses++;
      this.updateHitRate();

      return await dataSource();
    } catch (error) {
      logger.error('Write-through get error', { error, key: fullKey });
      return await dataSource();
    }
  }

  private async storeTags(key: string, tags: string[]): Promise<void> {
    const pipeline = this.redis.multi();
    tags.forEach((tag) => {
      const tagKey = `${this.namespace}:tag:${tag}`;
      pipeline.sAdd(tagKey, key);
      pipeline.expire(tagKey, 86400);
    });
    await pipeline.exec();
  }
}

/**
 * Write-Behind (Write-Back) Strategy
 * Best for: Write-heavy scenarios, eventual consistency acceptable
 *
 * Writes to cache immediately, persists to DB asynchronously
 */
export class WriteBehindStrategy extends BaseCacheStrategy {
  private writeQueue: Map<string, any> = new Map();
  private flushInterval: NodeJS.Timeout | null = null;
  private flushIntervalMs: number;
  private batchSize: number;

  constructor(
    redis: RedisClientType,
    namespace: string = 'write-behind',
    config: { flushIntervalMs?: number; batchSize?: number } = {}
  ) {
    super(redis, namespace);
    this.flushIntervalMs = config.flushIntervalMs || 5000;
    this.batchSize = config.batchSize || 100;

    this.startFlushInterval();
  }

  /**
   * Write to cache immediately, queue for DB write
   */
  async set<T>(
    key: string,
    data: T,
    dataSource: (entries: Map<string, T>) => Promise<void>,
    options: CacheOptions = {}
  ): Promise<void> {
    const fullKey = this.buildKey(key);
    const ttl = options.ttl || 3600;

    try {
      // Write to cache immediately
      await this.redis.setEx(fullKey, ttl, JSON.stringify(data));

      // Queue for background write
      this.writeQueue.set(key, { data, dataSource, options });

      this.stats.sets++;
      logger.debug('Write-behind queued', { key: fullKey, queueSize: this.writeQueue.size });

      // Flush if queue is large
      if (this.writeQueue.size >= this.batchSize) {
        await this.flush();
      }
    } catch (error) {
      logger.error('Write-behind error', { error, key: fullKey });
      throw error;
    }
  }

  /**
   * Flush pending writes to data source
   */
  async flush(): Promise<void> {
    if (this.writeQueue.size === 0) return;

    const entries = new Map(this.writeQueue);
    this.writeQueue.clear();

    logger.info('Flushing write-behind queue', { count: entries.size });

    // Group by data source
    const grouped = new Map<any, Map<string, any>>();
    entries.forEach((value, key) => {
      if (!grouped.has(value.dataSource)) {
        grouped.set(value.dataSource, new Map());
      }
      grouped.get(value.dataSource)!.set(key, value.data);
    });

    // Flush each group
    const promises = Array.from(grouped.entries()).map(async ([dataSource, data]) => {
      try {
        await dataSource(data);
        logger.debug('Write-behind flush completed', { count: data.size });
      } catch (error) {
        logger.error('Write-behind flush error', { error, count: data.size });
        // Re-queue failed writes
        data.forEach((value, key) => {
          this.writeQueue.set(key, entries.get(key)!);
        });
      }
    });

    await Promise.allSettled(promises);
  }

  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.flush().catch((err) => logger.error('Flush interval error', { error: err }));
    }, this.flushIntervalMs);
  }

  async destroy(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flush();
  }
}

/**
 * Cache Warming Strategy
 * Preload popular/critical data into cache
 */
export class CacheWarmingStrategy {
  private redis: RedisClientType;
  private namespace: string;

  constructor(redis: RedisClientType, namespace: string = 'cache-warming') {
    this.redis = redis;
    this.namespace = namespace;
  }

  /**
   * Warm cache with batch of data
   */
  async warm<T>(
    entries: Array<{ key: string; dataSource: () => Promise<T>; ttl?: number }>,
    options: { parallel?: number } = {}
  ): Promise<{ loaded: number; failed: number }> {
    const parallel = options.parallel || 10;
    let loaded = 0;
    let failed = 0;

    logger.info('Cache warming started', { total: entries.length, parallel });

    // Process in batches
    for (let i = 0; i < entries.length; i += parallel) {
      const batch = entries.slice(i, i + parallel);

      const results = await Promise.allSettled(
        batch.map(async ({ key, dataSource, ttl = 3600 }) => {
          const data = await dataSource();
          const fullKey = `${this.namespace}:${key}`;
          await this.redis.setEx(fullKey, ttl, JSON.stringify(data));
          return data;
        })
      );

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          loaded++;
        } else {
          failed++;
          logger.error('Cache warming entry failed', { error: result.reason });
        }
      });
    }

    logger.info('Cache warming completed', { loaded, failed });
    return { loaded, failed };
  }

  /**
   * Schedule periodic cache warming
   */
  scheduleWarming(
    dataSource: () => Promise<Array<{ key: string; data: any; ttl?: number }>>,
    intervalMs: number
  ): NodeJS.Timeout {
    const warmCache = async () => {
      try {
        const entries = await dataSource();
        const pipeline = this.redis.multi();

        entries.forEach(({ key, data, ttl = 3600 }) => {
          const fullKey = `${this.namespace}:${key}`;
          pipeline.setEx(fullKey, ttl, JSON.stringify(data));
        });

        await pipeline.exec();
        logger.info('Scheduled cache warming completed', { count: entries.length });
      } catch (error) {
        logger.error('Scheduled cache warming error', { error });
      }
    };

    // Run immediately
    warmCache();

    // Then schedule
    return setInterval(warmCache, intervalMs);
  }
}

/**
 * TTL Management Strategy
 * Different TTLs based on data type, access patterns, etc.
 */
export class TTLManagementStrategy {
  private static readonly DEFAULT_TTLS: Record<string, number> = {
    user: 3600, // 1 hour
    session: 1800, // 30 minutes
    product: 7200, // 2 hours
    static: 86400, // 24 hours
    frequent: 300, // 5 minutes
    rare: 3600, // 1 hour
  };

  /**
   * Get TTL based on data type and access pattern
   */
  static getTTL(
    dataType: string,
    accessPattern?: { readFrequency?: number; updateFrequency?: number }
  ): number {
    const baseTTL = this.DEFAULT_TTLS[dataType] || 3600;

    if (!accessPattern) return baseTTL;

    // Adjust based on access pattern
    const { readFrequency = 1, updateFrequency = 1 } = accessPattern;

    // High read, low update = longer TTL
    // Low read, high update = shorter TTL
    const ratio = readFrequency / updateFrequency;

    if (ratio > 10) return baseTTL * 2;
    if (ratio < 0.1) return baseTTL * 0.5;

    return baseTTL;
  }

  /**
   * Calculate adaptive TTL based on data freshness requirements
   */
  static getAdaptiveTTL(
    staleness: number, // max acceptable staleness in seconds
    confidence: number = 0.9 // confidence level (0-1)
  ): number {
    return Math.floor(staleness * confidence);
  }
}
