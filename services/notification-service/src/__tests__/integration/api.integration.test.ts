import request from 'supertest';
import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { notificationRoutes } from '../../routes/notification.routes';
import { errorHandler } from '../../middleware/error.middleware';
import { MockKafkaClient } from '../../../../../tests/helpers/kafka.mock';
import { MockDatabaseService } from '../../../../../tests/helpers/database.mock';
import { MockRedisService } from '../../../../../tests/helpers/redis.mock';
import {
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
} from '@notification-system/types';

// Mock logger
jest.mock('@notification-system/utils', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
  uuid: jest.fn(() => `test-uuid-${Date.now()}`),
}));

describe('Notification API Integration Tests', () => {
  let app: Application;
  let mockKafkaClient: MockKafkaClient;
  let mockDbService: MockDatabaseService;
  let mockRedisService: MockRedisService;

  beforeAll(() => {
    app = express();
    app.use(helmet());
    app.use(cors());
    app.use(express.json());

    mockKafkaClient = new MockKafkaClient();
    mockDbService = new MockDatabaseService();
    mockRedisService = new MockRedisService();

    app.locals.kafkaClient = mockKafkaClient;
    app.locals.dbService = mockDbService;
    app.locals.redisService = mockRedisService;

    app.use('/api/v1/notifications', notificationRoutes);
    app.use(errorHandler);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockKafkaClient.reset();
    mockDbService.reset();
    mockRedisService.reset();
    await mockDbService.connect();
    await mockRedisService.connect();
  });

  afterEach(async () => {
    await mockDbService.disconnect();
    await mockRedisService.disconnect();
  });

  describe('POST /api/v1/notifications', () => {
    it('should create a notification with all fields', async () => {
      const notificationRequest = {
        userId: 'user-123',
        channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
        priority: NotificationPriority.HIGH,
        subject: 'Integration Test',
        message: 'This is a test notification',
        metadata: {
          tags: ['test', 'integration'],
          customData: { key: 'value' },
        },
      };

      const response = await request(app)
        .post('/api/v1/notifications')
        .send(notificationRequest)
        .set('x-request-id', 'test-req-123')
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.status).toBe(NotificationStatus.PENDING);
      expect(response.body.metadata.requestId).toBe('test-req-123');

      // Verify database insertion
      expect(mockDbService.count()).toBe(1);

      // Verify Redis caching
      expect(mockRedisService.getCacheSize()).toBe(1);

      // Verify Kafka event
      expect(mockKafkaClient.publishedEvents).toHaveLength(1);
      expect(mockKafkaClient.publishedEvents[0].topic).toBe('notification.created');
    });

    it('should create notification with minimal fields', async () => {
      const notificationRequest = {
        userId: 'user-456',
        channels: [NotificationChannel.PUSH],
        message: 'Minimal notification',
      };

      const response = await request(app)
        .post('/api/v1/notifications')
        .send(notificationRequest)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');

      const notification = mockDbService.getAll()[0];
      expect(notification.priority).toBe(NotificationPriority.MEDIUM); // Default
    });

    it('should validate required fields', async () => {
      const invalidRequest = {
        channels: [NotificationChannel.EMAIL],
        message: 'Missing userId',
      };

      const response = await request(app)
        .post('/api/v1/notifications')
        .send(invalidRequest)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should handle multiple channels', async () => {
      const notificationRequest = {
        userId: 'user-multi',
        channels: [
          NotificationChannel.EMAIL,
          NotificationChannel.SMS,
          NotificationChannel.PUSH,
          NotificationChannel.IN_APP,
        ],
        message: 'Multi-channel notification',
      };

      const response = await request(app)
        .post('/api/v1/notifications')
        .send(notificationRequest)
        .expect(201);

      const notification = mockDbService.getAll()[0];
      expect(notification.channels).toHaveLength(4);
    });
  });

  describe('GET /api/v1/notifications/:id', () => {
    it('should retrieve notification by ID from cache', async () => {
      const notification = {
        id: 'notif-cache-123',
        userId: 'user-123',
        channels: [NotificationChannel.EMAIL],
        priority: NotificationPriority.MEDIUM,
        status: NotificationStatus.SENT,
        message: 'Cached notification',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await mockRedisService.cacheNotification(notification.id, notification);

      const response = await request(app)
        .get(`/api/v1/notifications/${notification.id}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe('notif-cache-123');
    });

    it('should retrieve notification from database when not cached', async () => {
      const notification = {
        id: 'notif-db-456',
        userId: 'user-456',
        channels: [NotificationChannel.SMS],
        priority: NotificationPriority.HIGH,
        status: NotificationStatus.DELIVERED,
        message: 'Database notification',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await mockDbService.createNotification(notification);

      const response = await request(app)
        .get(`/api/v1/notifications/${notification.id}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe('notif-db-456');

      // Should cache after fetching from DB
      expect(mockRedisService.getCacheSize()).toBe(1);
    });

    it('should return 404 for non-existent notification', async () => {
      const response = await request(app)
        .get('/api/v1/notifications/non-existent-id')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /api/v1/notifications/user/:userId', () => {
    beforeEach(async () => {
      // Create test notifications
      const notifications = [
        {
          id: 'notif-1',
          userId: 'user-123',
          channels: [NotificationChannel.EMAIL],
          priority: NotificationPriority.MEDIUM,
          status: NotificationStatus.SENT,
          message: 'Message 1',
          metadata: {},
          createdAt: new Date('2025-01-03'),
          updatedAt: new Date('2025-01-03'),
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
        {
          id: 'notif-3',
          userId: 'user-123',
          channels: [NotificationChannel.PUSH],
          priority: NotificationPriority.LOW,
          status: NotificationStatus.PENDING,
          message: 'Message 3',
          metadata: {},
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
      ];

      for (const notif of notifications) {
        await mockDbService.createNotification(notif);
      }
    });

    it('should retrieve user notifications with default pagination', async () => {
      const response = await request(app)
        .get('/api/v1/notifications/user/user-123')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      expect(response.body.metadata.limit).toBe(50);
      expect(response.body.metadata.offset).toBe(0);
    });

    it('should support custom pagination parameters', async () => {
      const response = await request(app)
        .get('/api/v1/notifications/user/user-123?limit=2&offset=1')
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.metadata.limit).toBe(2);
      expect(response.body.metadata.offset).toBe(1);
    });

    it('should return notifications in descending order by creation date', async () => {
      const response = await request(app)
        .get('/api/v1/notifications/user/user-123')
        .expect(200);

      const notifications = response.body.data;
      expect(notifications[0].id).toBe('notif-1'); // Most recent
      expect(notifications[2].id).toBe('notif-3'); // Oldest
    });

    it('should return empty array for user with no notifications', async () => {
      const response = await request(app)
        .get('/api/v1/notifications/user/user-no-notifs')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(0);
    });
  });

  describe('PATCH /api/v1/notifications/:id/status', () => {
    it('should update notification status', async () => {
      const notification = {
        id: 'notif-update-123',
        userId: 'user-123',
        channels: [NotificationChannel.EMAIL],
        priority: NotificationPriority.MEDIUM,
        status: NotificationStatus.SENT,
        message: 'Update test',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await mockDbService.createNotification(notification);
      await mockRedisService.cacheNotification(notification.id, notification);

      const response = await request(app)
        .patch(`/api/v1/notifications/${notification.id}/status`)
        .send({ status: NotificationStatus.DELIVERED })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe(NotificationStatus.DELIVERED);

      // Verify database updated
      const updated = await mockDbService.getNotification(notification.id);
      expect(updated?.status).toBe(NotificationStatus.DELIVERED);

      // Verify cache invalidated
      expect(mockRedisService.hasKey(`notification:${notification.id}`)).toBe(false);
    });

    it('should validate status value', async () => {
      const response = await request(app)
        .patch('/api/v1/notifications/notif-123/status')
        .send({ status: 'invalid-status' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      jest.spyOn(mockDbService, 'createNotification').mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const notificationRequest = {
        userId: 'user-123',
        channels: [NotificationChannel.EMAIL],
        message: 'Test message',
      };

      const response = await request(app)
        .post('/api/v1/notifications')
        .send(notificationRequest)
        .expect(500);

      expect(response.body.success).toBe(false);
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/v1/notifications')
        .set('Content-Type', 'application/json')
        .send('invalid-json{')
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });
});
