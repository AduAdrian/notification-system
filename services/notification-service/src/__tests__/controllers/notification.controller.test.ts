import { Request, Response, NextFunction } from 'express';
import { NotificationController } from '../../controllers/notification.controller';
import {
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
} from '@notification-system/types';
import { MockKafkaClient } from '../../../../../tests/helpers/kafka.mock';
import { MockDatabaseService } from '../../../../../tests/helpers/database.mock';
import { MockRedisService } from '../../../../../tests/helpers/redis.mock';

// Mock the utils module
jest.mock('@notification-system/utils', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
  uuid: jest.fn(() => 'test-uuid-123'),
}));

describe('NotificationController', () => {
  let controller: NotificationController;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let mockKafkaClient: MockKafkaClient;
  let mockDbService: MockDatabaseService;
  let mockRedisService: MockRedisService;

  beforeEach(() => {
    controller = new NotificationController();
    mockKafkaClient = new MockKafkaClient();
    mockDbService = new MockDatabaseService();
    mockRedisService = new MockRedisService();

    mockReq = {
      body: {},
      params: {},
      query: {},
      headers: {},
      app: {
        locals: {
          kafkaClient: mockKafkaClient,
          dbService: mockDbService,
          redisService: mockRedisService,
        },
      } as any,
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockKafkaClient.reset();
    mockDbService.reset();
    mockRedisService.reset();
  });

  describe('createNotification', () => {
    it('should create a notification successfully', async () => {
      const notificationRequest = {
        userId: 'user-123',
        channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
        priority: NotificationPriority.HIGH,
        subject: 'Test Subject',
        message: 'Test message',
        metadata: { customData: { key: 'value' } },
      };

      mockReq.body = notificationRequest;
      mockReq.headers = { 'x-request-id': 'req-123' };

      await controller.createNotification(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      // Verify database call
      expect(mockDbService.count()).toBe(1);
      const savedNotification = mockDbService.getAll()[0];
      expect(savedNotification.userId).toBe('user-123');
      expect(savedNotification.status).toBe(NotificationStatus.PENDING);

      // Verify Redis cache
      expect(mockRedisService.getCacheSize()).toBe(1);

      // Verify Kafka event
      expect(mockKafkaClient.publishedEvents).toHaveLength(1);
      expect(mockKafkaClient.publishedEvents[0].topic).toBe('notification.created');

      // Verify response
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: {
          id: 'test-uuid-123',
          status: NotificationStatus.PENDING,
          createdAt: expect.any(Date),
        },
        metadata: {
          requestId: 'req-123',
          timestamp: expect.any(Date),
        },
      });
    });

    it('should use default priority if not provided', async () => {
      mockReq.body = {
        userId: 'user-123',
        channels: [NotificationChannel.EMAIL],
        message: 'Test message',
      };

      await controller.createNotification(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      const savedNotification = mockDbService.getAll()[0];
      expect(savedNotification.priority).toBe(NotificationPriority.MEDIUM);
    });

    it('should handle errors gracefully', async () => {
      mockReq.body = {
        userId: 'user-123',
        channels: [NotificationChannel.EMAIL],
        message: 'Test message',
      };

      // Mock database error
      jest.spyOn(mockDbService, 'createNotification').mockRejectedValueOnce(
        new Error('Database error')
      );

      await controller.createNotification(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('getNotification', () => {
    it('should retrieve notification from cache', async () => {
      const notification = {
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

      await mockRedisService.cacheNotification('notif-123', notification);
      mockReq.params = { id: 'notif-123' };

      await controller.getNotification(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          id: 'notif-123',
          userId: 'user-123',
          channels: [NotificationChannel.EMAIL],
          priority: NotificationPriority.MEDIUM,
          status: NotificationStatus.SENT,
          message: 'Test message',
          metadata: {},
        }),
      });
    });

    it('should fallback to database if not in cache', async () => {
      const notification = {
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

      await mockDbService.createNotification(notification);
      mockReq.params = { id: 'notif-123' };

      await controller.getNotification(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      // Should cache the notification after fetching from DB
      expect(mockRedisService.getCacheSize()).toBe(1);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: notification,
      });
    });

    it('should return 404 if notification not found', async () => {
      mockReq.params = { id: 'non-existent' };

      await controller.getNotification(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Notification not found',
        },
      });
    });
  });

  describe('getUserNotifications', () => {
    it('should retrieve user notifications with pagination', async () => {
      const notifications = [
        {
          id: 'notif-1',
          userId: 'user-123',
          channels: [NotificationChannel.EMAIL],
          priority: NotificationPriority.MEDIUM,
          status: NotificationStatus.SENT,
          message: 'Message 1',
          metadata: {},
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
        {
          id: 'notif-2',
          userId: 'user-123',
          channels: [NotificationChannel.SMS],
          priority: NotificationPriority.HIGH,
          status: NotificationStatus.DELIVERED,
          message: 'Message 2',
          metadata: {},
          createdAt: new Date('2025-01-02'),
          updatedAt: new Date('2025-01-02'),
        },
      ];

      for (const notif of notifications) {
        await mockDbService.createNotification(notif);
      }

      mockReq.params = { userId: 'user-123' };
      mockReq.query = { limit: '10', offset: '0' };

      await controller.getUserNotifications(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({ id: 'notif-1' }),
          expect.objectContaining({ id: 'notif-2' }),
        ]),
        metadata: {
          total: 2,
          limit: 10,
          offset: 0,
        },
      });
    });

    it('should use default pagination values', async () => {
      mockReq.params = { userId: 'user-123' };
      mockReq.query = {};

      await controller.getUserNotifications(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            limit: 50,
            offset: 0,
          }),
        })
      );
    });
  });

  describe('updateStatus', () => {
    it('should update notification status', async () => {
      const notification = {
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

      await mockDbService.createNotification(notification);
      await mockRedisService.cacheNotification('notif-123', notification);

      mockReq.params = { id: 'notif-123' };
      mockReq.body = { status: NotificationStatus.DELIVERED };

      await controller.updateStatus(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      // Verify status updated in DB
      const updated = await mockDbService.getNotification('notif-123');
      expect(updated?.status).toBe(NotificationStatus.DELIVERED);

      // Verify cache invalidated
      expect(mockRedisService.hasKey('notification:notif-123')).toBe(false);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: { id: 'notif-123', status: NotificationStatus.DELIVERED },
      });
    });
  });
});
