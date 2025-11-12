import { ChannelOrchestrator } from '../orchestrator';
import {
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
  NotificationCreatedEvent,
} from '@notification-system/types';
import { MockKafkaClient } from '../../../../tests/helpers/kafka.mock';

// Mock logger
jest.mock('@notification-system/utils', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
  KafkaClient: jest.fn(),
}));

describe('ChannelOrchestrator', () => {
  let orchestrator: ChannelOrchestrator;
  let mockKafkaClient: MockKafkaClient;

  beforeEach(() => {
    mockKafkaClient = new MockKafkaClient();
    orchestrator = new ChannelOrchestrator(mockKafkaClient as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockKafkaClient.reset();
  });

  describe('start', () => {
    it('should subscribe to notification.created events', async () => {
      await orchestrator.start();

      expect(mockKafkaClient.subscriptions.has('notification.created')).toBe(true);
    });
  });

  describe('handleNotificationCreated', () => {
    it('should route EMAIL notification correctly', async () => {
      const event: NotificationCreatedEvent = {
        type: 'notification.created',
        data: {
          id: 'notif-123',
          userId: 'user-123',
          channels: [NotificationChannel.EMAIL],
          priority: NotificationPriority.MEDIUM,
          status: NotificationStatus.PENDING,
          subject: 'Test Email',
          message: 'Test message',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        timestamp: new Date(),
      };

      await orchestrator.start();
      await mockKafkaClient.simulateEvent('notification.created', event);

      const emailEvents = mockKafkaClient.getEventsByTopic('channel.email.queued');
      expect(emailEvents).toHaveLength(1);
      expect(emailEvents[0].type).toBe('channel.email.queued');
      expect(emailEvents[0].data).toMatchObject({
        notificationId: 'notif-123',
        channel: NotificationChannel.EMAIL,
      });
    });

    it('should route SMS notification correctly', async () => {
      const event: NotificationCreatedEvent = {
        type: 'notification.created',
        data: {
          id: 'notif-123',
          userId: 'user-123',
          channels: [NotificationChannel.SMS],
          priority: NotificationPriority.HIGH,
          status: NotificationStatus.PENDING,
          message: 'Test SMS message',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        timestamp: new Date(),
      };

      await orchestrator.start();
      await mockKafkaClient.simulateEvent('notification.created', event);

      const smsEvents = mockKafkaClient.getEventsByTopic('channel.sms.queued');
      expect(smsEvents).toHaveLength(1);
      expect(smsEvents[0].type).toBe('channel.sms.queued');
      expect(smsEvents[0].data).toMatchObject({
        notificationId: 'notif-123',
        channel: NotificationChannel.SMS,
      });
    });

    it('should route PUSH notification correctly', async () => {
      const event: NotificationCreatedEvent = {
        type: 'notification.created',
        data: {
          id: 'notif-123',
          userId: 'user-123',
          channels: [NotificationChannel.PUSH],
          priority: NotificationPriority.URGENT,
          status: NotificationStatus.PENDING,
          subject: 'Push Notification',
          message: 'Test push message',
          metadata: { customData: { key: 'value' } },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        timestamp: new Date(),
      };

      await orchestrator.start();
      await mockKafkaClient.simulateEvent('notification.created', event);

      const pushEvents = mockKafkaClient.getEventsByTopic('channel.push.queued');
      expect(pushEvents).toHaveLength(1);
      expect(pushEvents[0].type).toBe('channel.push.queued');
      expect(pushEvents[0].data.payload).toMatchObject({
        title: 'Push Notification',
        body: 'Test push message',
        data: { key: 'value' },
      });
    });

    it('should route IN_APP notification correctly', async () => {
      const event: NotificationCreatedEvent = {
        type: 'notification.created',
        data: {
          id: 'notif-123',
          userId: 'user-123',
          channels: [NotificationChannel.IN_APP],
          priority: NotificationPriority.MEDIUM,
          status: NotificationStatus.PENDING,
          subject: 'In-App Notification',
          message: 'Test in-app message',
          metadata: { actionUrl: 'https://example.com' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        timestamp: new Date(),
      };

      await orchestrator.start();
      await mockKafkaClient.simulateEvent('notification.created', event);

      const inAppEvents = mockKafkaClient.getEventsByTopic('channel.inapp.queued');
      expect(inAppEvents).toHaveLength(1);
      expect(inAppEvents[0].type).toBe('channel.inapp.queued');
      expect(inAppEvents[0].data.payload).toMatchObject({
        userId: 'user-123',
        title: 'In-App Notification',
        message: 'Test in-app message',
        actionUrl: 'https://example.com',
      });
    });

    it('should route to multiple channels', async () => {
      const event: NotificationCreatedEvent = {
        type: 'notification.created',
        data: {
          id: 'notif-123',
          userId: 'user-123',
          channels: [
            NotificationChannel.EMAIL,
            NotificationChannel.SMS,
            NotificationChannel.PUSH,
          ],
          priority: NotificationPriority.HIGH,
          status: NotificationStatus.PENDING,
          subject: 'Multi-channel notification',
          message: 'Test message',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        timestamp: new Date(),
      };

      await orchestrator.start();
      await mockKafkaClient.simulateEvent('notification.created', event);

      expect(mockKafkaClient.getEventsByTopic('channel.email.queued')).toHaveLength(1);
      expect(mockKafkaClient.getEventsByTopic('channel.sms.queued')).toHaveLength(1);
      expect(mockKafkaClient.getEventsByTopic('channel.push.queued')).toHaveLength(1);
    });

    it('should handle routing errors gracefully', async () => {
      // Mock publishEvent to throw error for email channel
      const originalPublish = mockKafkaClient.publishEvent.bind(mockKafkaClient);
      mockKafkaClient.publishEvent = jest.fn().mockImplementation(async (topic, event) => {
        if (topic === 'channel.email.queued') {
          throw new Error('Kafka error');
        }
        return originalPublish(topic, event);
      });

      const event: NotificationCreatedEvent = {
        type: 'notification.created',
        data: {
          id: 'notif-123',
          userId: 'user-123',
          channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
          priority: NotificationPriority.MEDIUM,
          status: NotificationStatus.PENDING,
          message: 'Test message',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        timestamp: new Date(),
      };

      await orchestrator.start();
      await mockKafkaClient.simulateEvent('notification.created', event);

      // SMS should still be processed despite email error
      expect(mockKafkaClient.publishEvent).toHaveBeenCalledWith(
        'channel.sms.queued',
        expect.any(Object)
      );
    });
  });

  describe('routeToChannel', () => {
    it('should include default subject for email when not provided', async () => {
      const event: NotificationCreatedEvent = {
        type: 'notification.created',
        data: {
          id: 'notif-123',
          userId: 'user-123',
          channels: [NotificationChannel.EMAIL],
          priority: NotificationPriority.MEDIUM,
          status: NotificationStatus.PENDING,
          message: 'Test message without subject',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        timestamp: new Date(),
      };

      await orchestrator.start();
      await mockKafkaClient.simulateEvent('notification.created', event);

      const emailEvents = mockKafkaClient.getEventsByTopic('channel.email.queued');
      expect(emailEvents[0].data.payload.subject).toBe('New Notification');
    });

    it('should include default title for push when not provided', async () => {
      const event: NotificationCreatedEvent = {
        type: 'notification.created',
        data: {
          id: 'notif-123',
          userId: 'user-123',
          channels: [NotificationChannel.PUSH],
          priority: NotificationPriority.MEDIUM,
          status: NotificationStatus.PENDING,
          message: 'Test message without title',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        timestamp: new Date(),
      };

      await orchestrator.start();
      await mockKafkaClient.simulateEvent('notification.created', event);

      const pushEvents = mockKafkaClient.getEventsByTopic('channel.push.queued');
      expect(pushEvents[0].data.payload.title).toBe('Notification');
    });
  });
});
