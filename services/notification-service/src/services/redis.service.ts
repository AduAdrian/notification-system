import { createClient, RedisClientType } from 'redis';
import { Notification } from '@notification-system/types';
import { createLogger } from '@notification-system/utils';

const logger = createLogger('redis-service');

export class RedisService {
  private _client: RedisClientType;
  private readonly TTL = 3600; // 1 hour
  private connectionStats = {
    totalConnects: 0,
    totalErrors: 0,
    reconnects: 0,
  };

  constructor() {
    this._client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      // 2025 best practices: lazy connection to prevent startup delays
      lazyConnect: true,
      // Connection timeouts
      socket: {
        connectTimeout: 3000, // 3s connection timeout
        reconnectStrategy: (retries) => {
          // Exponential backoff with max delay
          if (retries > 10) {
            logger.error('Redis max reconnection attempts reached');
            return new Error('Redis reconnection failed');
          }
          const delay = Math.min(retries * 100, 3000);
          logger.warn(`Redis reconnecting in ${delay}ms (attempt ${retries})`);
          return delay;
        },
      },
      // Request retry strategy
      maxRetriesPerRequest: 3,
      // Enable connection pooling through multiplexing
      enableAutoPipelining: true,
      enableOfflineQueue: true,
    });

    // Connection event monitoring
    this._client.on('connect', () => {
      this.connectionStats.totalConnects++;
      logger.info('Redis connection established', {
        totalConnects: this.connectionStats.totalConnects,
      });
    });

    this._client.on('ready', () => {
      logger.info('Redis client ready');
    });

    this._client.on('reconnecting', () => {
      this.connectionStats.reconnects++;
      logger.warn('Redis reconnecting...', {
        reconnects: this.connectionStats.reconnects,
      });
    });

    this._client.on('error', (err) => {
      this.connectionStats.totalErrors++;
      logger.error('Redis error', {
        error: err,
        totalErrors: this.connectionStats.totalErrors,
      });
    });

    this._client.on('end', () => {
      logger.info('Redis connection closed');
    });
  }

  get client(): RedisClientType {
    return this._client;
  }

  async connect(): Promise<void> {
    await this._client.connect();
    logger.info('Redis connected successfully');
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this._client.ping();
      return true;
    } catch {
      return false;
    }
  }

  async cacheNotification(id: string, notification: Notification): Promise<void> {
    try {
      await this._client.setEx(
        `notification:${id}`,
        this.TTL,
        JSON.stringify(notification)
      );
    } catch (error) {
      logger.error('Failed to cache notification', { error, id });
    }
  }

  async getNotification(id: string): Promise<Notification | null> {
    try {
      const data = await this._client.get(`notification:${id}`);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error('Failed to get cached notification', { error, id });
      return null;
    }
  }

  async deleteNotification(id: string): Promise<void> {
    try {
      await this._client.del(`notification:${id}`);
    } catch (error) {
      logger.error('Failed to delete cached notification', { error, id });
    }
  }

  async checkRateLimit(userId: string, maxRequests: number, windowSeconds: number): Promise<boolean> {
    const key = `ratelimit:${userId}`;
    try {
      const current = await this._client.incr(key);
      if (current === 1) {
        await this._client.expire(key, windowSeconds);
      }
      return current <= maxRequests;
    } catch (error) {
      logger.error('Failed to check rate limit', { error, userId });
      return true; // Fail open
    }
  }

  async disconnect(): Promise<void> {
    await this._client.quit();
    logger.info('Redis disconnected');
  }

  /**
   * Get connection statistics for monitoring
   */
  getConnectionStats() {
    return {
      ...this.connectionStats,
      isOpen: this._client.isOpen,
      isReady: this._client.isReady,
    };
  }
}
