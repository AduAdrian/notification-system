import { Notification } from '@notification-system/types';

export class MockRedisService {
  private cache: Map<string, string> = new Map();
  private rateLimits: Map<string, { count: number; expiry: number }> = new Map();
  public connected = false;

  async connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  async cacheNotification(id: string, notification: Notification): Promise<void> {
    this.cache.set(`notification:${id}`, JSON.stringify(notification));
    return Promise.resolve();
  }

  async getNotification(id: string): Promise<Notification | null> {
    const data = this.cache.get(`notification:${id}`);
    return data ? JSON.parse(data) : null;
  }

  async deleteNotification(id: string): Promise<void> {
    this.cache.delete(`notification:${id}`);
    return Promise.resolve();
  }

  async checkRateLimit(
    userId: string,
    maxRequests: number,
    windowSeconds: number
  ): Promise<boolean> {
    const key = `ratelimit:${userId}`;
    const now = Date.now();
    const limit = this.rateLimits.get(key);

    if (!limit || limit.expiry < now) {
      // Create new rate limit window
      this.rateLimits.set(key, {
        count: 1,
        expiry: now + windowSeconds * 1000,
      });
      return true;
    }

    // Increment counter
    limit.count++;
    return limit.count <= maxRequests;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }

  // Helper methods for testing
  reset(): void {
    this.cache.clear();
    this.rateLimits.clear();
    this.connected = false;
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  hasKey(key: string): boolean {
    return this.cache.has(key);
  }
}

export const createMockRedisService = (): MockRedisService => {
  return new MockRedisService();
};
