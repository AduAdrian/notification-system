import { createClient, RedisClientType } from 'redis';
import { Notification } from '@notification-system/types';
import { createLogger } from '@notification-system/utils';

const logger = createLogger('redis-service');

export class RedisService {
  private client: RedisClientType;
  private readonly TTL = 3600; // 1 hour

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });

    this.client.on('error', (err) => logger.error('Redis error', { error: err }));
  }

  async connect(): Promise<void> {
    await this.client.connect();
    logger.info('Redis connected successfully');
  }

  async cacheNotification(id: string, notification: Notification): Promise<void> {
    try {
      await this.client.setEx(
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
      const data = await this.client.get(`notification:${id}`);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error('Failed to get cached notification', { error, id });
      return null;
    }
  }

  async deleteNotification(id: string): Promise<void> {
    try {
      await this.client.del(`notification:${id}`);
    } catch (error) {
      logger.error('Failed to delete cached notification', { error, id });
    }
  }

  async checkRateLimit(userId: string, maxRequests: number, windowSeconds: number): Promise<boolean> {
    const key = `ratelimit:${userId}`;
    try {
      const current = await this.client.incr(key);
      if (current === 1) {
        await this.client.expire(key, windowSeconds);
      }
      return current <= maxRequests;
    } catch (error) {
      logger.error('Failed to check rate limit', { error, userId });
      return true; // Fail open
    }
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
    logger.info('Redis disconnected');
  }
}
