import { RedisService } from '../../services/redis.service';
import {
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
  Notification,
} from '@notification-system/types';

// Mock redis module
const mockRedisClient = {
  connect: jest.fn(),
  setEx: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  quit: jest.fn(),
  on: jest.fn(),
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient),
}));

// Mock logger
jest.mock('@notification-system/utils', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe('RedisService', () => {
  let service: RedisService;

  beforeEach(() => {
    service = new RedisService();
    jest.clearAllMocks();
  });

  describe('connect', () => {
    it('should connect to Redis successfully', async () => {
      mockRedisClient.connect.mockResolvedValueOnce(undefined);

      await service.connect();

      expect(mockRedisClient.connect).toHaveBeenCalled();
    });

    it('should handle connection errors', async () => {
      const error = new Error('Connection failed');
      mockRedisClient.connect.mockRejectedValueOnce(error);

      await expect(service.connect()).rejects.toThrow('Connection failed');
    });
  });

  describe('cacheNotification', () => {
    it('should cache notification with TTL', async () => {
      const notification: Notification = {
        id: 'notif-123',
        userId: 'user-123',
        channels: [NotificationChannel.EMAIL],
        priority: NotificationPriority.MEDIUM,
        status: NotificationStatus.SENT,
        message: 'Test message',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRedisClient.setEx.mockResolvedValueOnce('OK');

      await service.cacheNotification('notif-123', notification);

      expect(mockRedisClient.setEx).toHaveBeenCalledWith(
        'notification:notif-123',
        3600, // TTL
        JSON.stringify(notification)
      );
    });

    it('should handle cache errors gracefully', async () => {
      const notification: Notification = {
        id: 'notif-123',
        userId: 'user-123',
        channels: [NotificationChannel.EMAIL],
        priority: NotificationPriority.MEDIUM,
        status: NotificationStatus.SENT,
        message: 'Test message',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRedisClient.setEx.mockRejectedValueOnce(new Error('Cache error'));

      // Should not throw
      await expect(
        service.cacheNotification('notif-123', notification)
      ).resolves.toBeUndefined();
    });
  });

  describe('getNotification', () => {
    it('should retrieve cached notification', async () => {
      const notification: Notification = {
        id: 'notif-123',
        userId: 'user-123',
        channels: [NotificationChannel.EMAIL],
        priority: NotificationPriority.MEDIUM,
        status: NotificationStatus.SENT,
        message: 'Test message',
        metadata: {},
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
      };

      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(notification));

      const result = await service.getNotification('notif-123');

      expect(mockRedisClient.get).toHaveBeenCalledWith('notification:notif-123');
      expect(result).toEqual(notification);
    });

    it('should return null if not cached', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null);

      const result = await service.getNotification('notif-123');

      expect(result).toBeNull();
    });

    it('should return null on cache errors', async () => {
      mockRedisClient.get.mockRejectedValueOnce(new Error('Cache error'));

      const result = await service.getNotification('notif-123');

      expect(result).toBeNull();
    });
  });

  describe('deleteNotification', () => {
    it('should delete cached notification', async () => {
      mockRedisClient.del.mockResolvedValueOnce(1);

      await service.deleteNotification('notif-123');

      expect(mockRedisClient.del).toHaveBeenCalledWith('notification:notif-123');
    });

    it('should handle delete errors gracefully', async () => {
      mockRedisClient.del.mockRejectedValueOnce(new Error('Delete error'));

      // Should not throw
      await expect(service.deleteNotification('notif-123')).resolves.toBeUndefined();
    });
  });

  describe('checkRateLimit', () => {
    it('should allow request within rate limit', async () => {
      mockRedisClient.incr.mockResolvedValueOnce(1);
      mockRedisClient.expire.mockResolvedValueOnce(1);

      const result = await service.checkRateLimit('user-123', 10, 60);

      expect(mockRedisClient.incr).toHaveBeenCalledWith('ratelimit:user-123');
      expect(mockRedisClient.expire).toHaveBeenCalledWith('ratelimit:user-123', 60);
      expect(result).toBe(true);
    });

    it('should deny request when rate limit exceeded', async () => {
      mockRedisClient.incr.mockResolvedValueOnce(11);

      const result = await service.checkRateLimit('user-123', 10, 60);

      expect(result).toBe(false);
    });

    it('should set expiry on first request', async () => {
      mockRedisClient.incr.mockResolvedValueOnce(1);
      mockRedisClient.expire.mockResolvedValueOnce(1);

      await service.checkRateLimit('user-123', 10, 60);

      expect(mockRedisClient.expire).toHaveBeenCalledWith('ratelimit:user-123', 60);
    });

    it('should not set expiry on subsequent requests', async () => {
      mockRedisClient.incr.mockResolvedValueOnce(5);

      await service.checkRateLimit('user-123', 10, 60);

      expect(mockRedisClient.expire).not.toHaveBeenCalled();
    });

    it('should fail open on errors', async () => {
      mockRedisClient.incr.mockRejectedValueOnce(new Error('Redis error'));

      const result = await service.checkRateLimit('user-123', 10, 60);

      // Should return true to fail open
      expect(result).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('should disconnect from Redis', async () => {
      mockRedisClient.quit.mockResolvedValueOnce('OK');

      await service.disconnect();

      expect(mockRedisClient.quit).toHaveBeenCalled();
    });
  });
});
