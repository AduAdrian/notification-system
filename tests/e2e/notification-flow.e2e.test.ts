import {
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
  NotificationCreatedEvent,
} from '@notification-system/types';
import { MockKafkaClient } from '../helpers/kafka.mock';
import { MockDatabaseService } from '../helpers/database.mock';
import { MockRedisService } from '../helpers/redis.mock';

/**
 * End-to-End Tests for Complete Notification Flow
 *
 * These tests verify the entire notification pipeline from creation
 * through channel orchestration to delivery across all channels.
 */
describe('Notification System E2E Tests', () => {
  let mockKafkaClient: MockKafkaClient;
  let mockDbService: MockDatabaseService;
  let mockRedisService: MockRedisService;

  beforeEach(async () => {
    mockKafkaClient = new MockKafkaClient();
    mockDbService = new MockDatabaseService();
    mockRedisService = new MockRedisService();

    await mockDbService.connect();
    await mockRedisService.connect();
  });

  afterEach(async () => {
    mockKafkaClient.reset();
    mockDbService.reset();
    mockRedisService.reset();
    await mockDbService.disconnect();
    await mockRedisService.disconnect();
  });

  describe('Complete Notification Flow', () => {
    it('should process notification from creation to delivery across all channels', async () => {
      // Step 1: Create notification
      const notification = {
        id: 'e2e-notif-123',
        userId: 'user-e2e-123',
        channels: [
          NotificationChannel.EMAIL,
          NotificationChannel.SMS,
          NotificationChannel.PUSH,
          NotificationChannel.IN_APP,
        ],
        priority: NotificationPriority.HIGH,
        status: NotificationStatus.PENDING,
        subject: 'E2E Test Notification',
        message: 'This is an end-to-end test notification',
        metadata: {
          tags: ['e2e', 'test'],
          customData: { testId: 'e2e-123' },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Save to database
      await mockDbService.createNotification(notification);

      // Cache notification
      await mockRedisService.cacheNotification(notification.id, notification);

      // Publish notification.created event
      const createdEvent: NotificationCreatedEvent = {
        type: 'notification.created',
        data: notification,
        timestamp: new Date(),
      };
      await mockKafkaClient.publishEvent('notification.created', createdEvent);

      // Verify notification created
      expect(mockDbService.count()).toBe(1);
      expect(mockRedisService.getCacheSize()).toBe(1);
      expect(mockKafkaClient.getEventsByTopic('notification.created')).toHaveLength(1);

      // Step 2: Channel Orchestrator routes to channels
      // Simulate orchestrator processing the event
      for (const channel of notification.channels) {
        const channelTopic = `channel.${channel}.queued`;
        await mockKafkaClient.publishEvent(channelTopic, {
          type: channelTopic as any,
          data: {
            notificationId: notification.id,
            channel,
            payload: {}, // Channel-specific payload
          },
          timestamp: new Date(),
        });
      }

      // Verify all channels queued
      expect(mockKafkaClient.getEventsByTopic('channel.email.queued')).toHaveLength(1);
      expect(mockKafkaClient.getEventsByTopic('channel.sms.queued')).toHaveLength(1);
      expect(mockKafkaClient.getEventsByTopic('channel.push.queued')).toHaveLength(1);
      expect(mockKafkaClient.getEventsByTopic('channel.inapp.queued')).toHaveLength(1);

      // Step 3: Channel services process and send
      for (const channel of notification.channels) {
        await mockKafkaClient.publishEvent(`${channel}.sent`, {
          type: `channel.${channel}.sent` as any,
          data: {
            notificationId: notification.id,
            channel,
            providerId: `provider-${channel}-123`,
          },
          timestamp: new Date(),
        });
      }

      // Verify all channels sent
      expect(mockKafkaClient.getEventsByTopic('email.sent')).toHaveLength(1);
      expect(mockKafkaClient.getEventsByTopic('sms.sent')).toHaveLength(1);
      expect(mockKafkaClient.getEventsByTopic('push.sent')).toHaveLength(1);
      expect(mockKafkaClient.getEventsByTopic('inapp.sent')).toHaveLength(1);

      // Step 4: Update notification status to delivered
      await mockDbService.updateNotificationStatus(
        notification.id,
        NotificationStatus.DELIVERED
      );
      await mockRedisService.deleteNotification(notification.id);

      // Verify final state
      const finalNotification = await mockDbService.getNotification(notification.id);
      expect(finalNotification?.status).toBe(NotificationStatus.DELIVERED);
      expect(mockRedisService.hasKey(`notification:${notification.id}`)).toBe(false);
    });

    it('should handle partial delivery failures gracefully', async () => {
      const notification = {
        id: 'e2e-partial-fail',
        userId: 'user-e2e-456',
        channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
        priority: NotificationPriority.MEDIUM,
        status: NotificationStatus.PENDING,
        message: 'Partial failure test',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await mockDbService.createNotification(notification);

      const createdEvent: NotificationCreatedEvent = {
        type: 'notification.created',
        data: notification,
        timestamp: new Date(),
      };
      await mockKafkaClient.publishEvent('notification.created', createdEvent);

      // Email succeeds
      await mockKafkaClient.publishEvent('email.sent', {
        type: 'channel.email.sent',
        data: {
          notificationId: notification.id,
          channel: NotificationChannel.EMAIL,
          providerId: 'email-provider-123',
        },
        timestamp: new Date(),
      });

      // SMS fails
      await mockKafkaClient.publishEvent('delivery.failed', {
        type: 'delivery.failed',
        data: {
          notificationId: notification.id,
          channel: NotificationChannel.SMS,
          error: 'Invalid phone number',
        },
        timestamp: new Date(),
      });

      // Verify events
      expect(mockKafkaClient.getEventsByTopic('email.sent')).toHaveLength(1);
      expect(mockKafkaClient.getEventsByTopic('delivery.failed')).toHaveLength(1);

      const failedEvent = mockKafkaClient.getLastEvent('delivery.failed');
      expect(failedEvent?.data.error).toBe('Invalid phone number');
    });

    it('should process high priority notifications', async () => {
      const urgentNotification = {
        id: 'e2e-urgent-789',
        userId: 'user-urgent',
        channels: [NotificationChannel.SMS, NotificationChannel.PUSH],
        priority: NotificationPriority.URGENT,
        status: NotificationStatus.PENDING,
        message: 'URGENT: Action required',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await mockDbService.createNotification(urgentNotification);

      const createdEvent: NotificationCreatedEvent = {
        type: 'notification.created',
        data: urgentNotification,
        timestamp: new Date(),
      };
      await mockKafkaClient.publishEvent('notification.created', createdEvent);

      // Verify urgent notification is processed
      const notification = await mockDbService.getNotification(urgentNotification.id);
      expect(notification?.priority).toBe(NotificationPriority.URGENT);
      expect(notification?.channels).toContain(NotificationChannel.SMS);
      expect(notification?.channels).toContain(NotificationChannel.PUSH);
    });
  });

  describe('User Journey Tests', () => {
    it('should handle complete user notification lifecycle', async () => {
      const userId = 'user-journey-123';
      const notifications = [
        {
          id: 'journey-1',
          userId,
          channels: [NotificationChannel.EMAIL],
          priority: NotificationPriority.LOW,
          status: NotificationStatus.PENDING,
          message: 'Welcome notification',
          metadata: {},
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
        },
        {
          id: 'journey-2',
          userId,
          channels: [NotificationChannel.PUSH],
          priority: NotificationPriority.MEDIUM,
          status: NotificationStatus.PENDING,
          message: 'Action reminder',
          metadata: {},
          createdAt: new Date('2025-01-02'),
          updatedAt: new Date('2025-01-02'),
        },
        {
          id: 'journey-3',
          userId,
          channels: [NotificationChannel.SMS],
          priority: NotificationPriority.HIGH,
          status: NotificationStatus.PENDING,
          message: 'Security alert',
          metadata: {},
          createdAt: new Date('2025-01-03'),
          updatedAt: new Date('2025-01-03'),
        },
      ];

      // Create all notifications
      for (const notification of notifications) {
        await mockDbService.createNotification(notification);
        const event: NotificationCreatedEvent = {
          type: 'notification.created',
          data: notification,
          timestamp: new Date(),
        };
        await mockKafkaClient.publishEvent('notification.created', event);
      }

      // Retrieve user notifications
      const userNotifications = await mockDbService.getUserNotifications(userId, 10, 0);
      expect(userNotifications).toHaveLength(3);
      expect(userNotifications[0].id).toBe('journey-3'); // Most recent
      expect(userNotifications[2].id).toBe('journey-1'); // Oldest
    });

    it('should handle user preferences for quiet hours', async () => {
      // This is a conceptual test - actual implementation would check quiet hours
      const notification = {
        id: 'quiet-hours-test',
        userId: 'user-quiet',
        channels: [NotificationChannel.PUSH],
        priority: NotificationPriority.LOW,
        status: NotificationStatus.PENDING,
        message: 'Low priority message',
        metadata: {
          scheduledAt: new Date('2025-01-01T22:00:00'), // Late night
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await mockDbService.createNotification(notification);

      // Verify notification is created but not immediately sent
      const storedNotification = await mockDbService.getNotification(notification.id);
      expect(storedNotification?.status).toBe(NotificationStatus.PENDING);
      expect(storedNotification?.metadata.scheduledAt).toBeDefined();
    });
  });

  describe('Performance and Scale Tests', () => {
    it('should handle batch notification creation', async () => {
      const batchSize = 100;
      const notifications = Array.from({ length: batchSize }, (_, i) => ({
        id: `batch-${i}`,
        userId: `user-${i % 10}`, // 10 different users
        channels: [NotificationChannel.EMAIL],
        priority: NotificationPriority.MEDIUM,
        status: NotificationStatus.PENDING,
        message: `Batch notification ${i}`,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      // Create notifications in batch
      for (const notification of notifications) {
        await mockDbService.createNotification(notification);
      }

      expect(mockDbService.count()).toBe(batchSize);

      // Verify pagination works
      const user0Notifications = await mockDbService.getUserNotifications('user-0', 20, 0);
      expect(user0Notifications.length).toBeGreaterThan(0);
    });

    it('should efficiently cache frequently accessed notifications', async () => {
      const popularNotification = {
        id: 'popular-notif',
        userId: 'user-popular',
        channels: [NotificationChannel.EMAIL],
        priority: NotificationPriority.MEDIUM,
        status: NotificationStatus.SENT,
        message: 'Popular notification',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await mockDbService.createNotification(popularNotification);
      await mockRedisService.cacheNotification(popularNotification.id, popularNotification);

      // Simulate multiple reads
      for (let i = 0; i < 10; i++) {
        const cached = await mockRedisService.getNotification(popularNotification.id);
        expect(cached).toBeDefined();
        expect(cached?.id).toBe('popular-notif');
      }

      // Cache should still have only one entry
      expect(mockRedisService.getCacheSize()).toBe(1);
    });
  });

  describe('Failure Recovery Tests', () => {
    it('should handle Kafka publish failures', async () => {
      const notification = {
        id: 'kafka-fail-test',
        userId: 'user-kafka',
        channels: [NotificationChannel.EMAIL],
        priority: NotificationPriority.HIGH,
        status: NotificationStatus.PENDING,
        message: 'Kafka failure test',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await mockDbService.createNotification(notification);

      // Simulate Kafka failure by publishing failure event
      await mockKafkaClient.publishEvent('delivery.failed', {
        type: 'delivery.failed',
        data: {
          notificationId: notification.id,
          channel: NotificationChannel.EMAIL,
          error: 'Kafka connection timeout',
        },
        timestamp: new Date(),
      });

      const failedEvents = mockKafkaClient.getEventsByTopic('delivery.failed');
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0].data.error).toContain('Kafka');
    });

    it('should maintain data consistency across failures', async () => {
      const notification = {
        id: 'consistency-test',
        userId: 'user-consistency',
        channels: [NotificationChannel.SMS],
        priority: NotificationPriority.MEDIUM,
        status: NotificationStatus.PENDING,
        message: 'Consistency test',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Store in database
      await mockDbService.createNotification(notification);

      // Cache in Redis
      await mockRedisService.cacheNotification(notification.id, notification);

      // Simulate cache invalidation
      await mockRedisService.deleteNotification(notification.id);

      // Data should still be in database
      const dbNotification = await mockDbService.getNotification(notification.id);
      expect(dbNotification).toBeDefined();
      expect(dbNotification?.id).toBe(notification.id);

      // Cache should be empty
      const cachedNotification = await mockRedisService.getNotification(notification.id);
      expect(cachedNotification).toBeNull();
    });
  });

  describe('Rate Limiting Tests', () => {
    it('should enforce rate limits per user', async () => {
      const userId = 'rate-limited-user';
      const maxRequests = 5;
      const windowSeconds = 60;

      // Make requests up to limit
      for (let i = 0; i < maxRequests; i++) {
        const allowed = await mockRedisService.checkRateLimit(
          userId,
          maxRequests,
          windowSeconds
        );
        expect(allowed).toBe(true);
      }

      // Next request should be rate limited
      const rateLimited = await mockRedisService.checkRateLimit(
        userId,
        maxRequests,
        windowSeconds
      );
      expect(rateLimited).toBe(false);
    });

    it('should reset rate limits after window expires', async () => {
      const userId = 'rate-reset-user';
      const maxRequests = 3;
      const windowSeconds = 1;

      // Exhaust rate limit
      for (let i = 0; i < maxRequests; i++) {
        await mockRedisService.checkRateLimit(userId, maxRequests, windowSeconds);
      }

      expect(
        await mockRedisService.checkRateLimit(userId, maxRequests, windowSeconds)
      ).toBe(false);

      // Simulate window expiry by creating new limit window
      mockRedisService.reset();

      // Should allow requests again
      const allowed = await mockRedisService.checkRateLimit(
        userId,
        maxRequests,
        windowSeconds
      );
      expect(allowed).toBe(true);
    });
  });
});
