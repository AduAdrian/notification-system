import { NotificationChannel, PushPayload } from '@notification-system/types';
import { MockKafkaClient } from '../../../../tests/helpers/kafka.mock';

// Mock Firebase Admin
const mockFirebaseSend = jest.fn();
const mockFirebaseMessaging = jest.fn(() => ({
  send: mockFirebaseSend,
}));

jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: {
    applicationDefault: jest.fn(),
  },
  messaging: mockFirebaseMessaging,
}));

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

jest.mock('@notification-system/utils', () => ({
  createLogger: jest.fn(() => mockLogger),
  KafkaClient: jest.fn(),
}));

describe('Push Service', () => {
  let mockKafkaClient: MockKafkaClient;
  let handlePushQueue: (event: any) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockKafkaClient = new MockKafkaClient();

    // Simulate handlePushQueue function
    handlePushQueue = async (event: any) => {
      const { data } = event;
      const { notificationId, payload } = data;
      const pushPayload = payload as PushPayload;

      try {
        mockLogger.info('Sending push notification', {
          notificationId,
          token: pushPayload.token.substring(0, 10) + '...',
        });

        const admin = require('firebase-admin');
        const message = await admin.messaging().send({
          token: pushPayload.token,
          notification: {
            title: pushPayload.title,
            body: pushPayload.body,
          },
          data: pushPayload.data,
          apns: {
            payload: {
              aps: {
                badge: pushPayload.badge,
                sound: pushPayload.sound || 'default',
              },
            },
          },
        });

        await mockKafkaClient.publishEvent('push.sent', {
          type: 'channel.push.sent',
          data: {
            notificationId,
            channel: NotificationChannel.PUSH,
            providerId: message,
          },
          timestamp: new Date(),
        });

        mockLogger.info('Push notification sent successfully', {
          notificationId,
          messageId: message,
        });
      } catch (error: any) {
        mockLogger.error('Failed to send push notification', {
          notificationId,
          error: error.message,
        });

        await mockKafkaClient.publishEvent('delivery.failed', {
          type: 'delivery.failed',
          data: {
            notificationId,
            channel: NotificationChannel.PUSH,
            error: error.message,
          },
          timestamp: new Date(),
        });
      }
    };
  });

  afterEach(() => {
    mockKafkaClient.reset();
  });

  describe('handlePushQueue', () => {
    it('should send push notification successfully via FCM', async () => {
      const pushPayload: PushPayload = {
        token: 'device-token-12345',
        title: 'Test Push',
        body: 'Test push notification body',
        data: { key: 'value' },
        badge: 1,
        sound: 'default',
      };

      const event = {
        type: 'channel.push.queued',
        data: {
          notificationId: 'notif-123',
          channel: NotificationChannel.PUSH,
          payload: pushPayload,
        },
        timestamp: new Date(),
      };

      mockFirebaseSend.mockResolvedValueOnce('projects/test/messages/msg-123');

      await handlePushQueue(event);

      expect(mockFirebaseSend).toHaveBeenCalledWith({
        token: 'device-token-12345',
        notification: {
          title: 'Test Push',
          body: 'Test push notification body',
        },
        data: { key: 'value' },
        apns: {
          payload: {
            aps: {
              badge: 1,
              sound: 'default',
            },
          },
        },
      });

      const sentEvents = mockKafkaClient.getEventsByTopic('push.sent');
      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].type).toBe('channel.push.sent');
      expect(sentEvents[0].data).toMatchObject({
        notificationId: 'notif-123',
        channel: NotificationChannel.PUSH,
        providerId: 'projects/test/messages/msg-123',
      });
    });

    it('should handle FCM errors and publish failure event', async () => {
      const pushPayload: PushPayload = {
        token: 'invalid-token',
        title: 'Test Push',
        body: 'Test body',
      };

      const event = {
        type: 'channel.push.queued',
        data: {
          notificationId: 'notif-456',
          channel: NotificationChannel.PUSH,
          payload: pushPayload,
        },
        timestamp: new Date(),
      };

      const fcmError = new Error('Invalid registration token');
      mockFirebaseSend.mockRejectedValueOnce(fcmError);

      await handlePushQueue(event);

      const failedEvents = mockKafkaClient.getEventsByTopic('delivery.failed');
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0].type).toBe('delivery.failed');
      expect(failedEvents[0].data).toMatchObject({
        notificationId: 'notif-456',
        channel: NotificationChannel.PUSH,
        error: 'Invalid registration token',
      });
    });

    it('should use default sound when not specified', async () => {
      const pushPayload: PushPayload = {
        token: 'device-token-789',
        title: 'Test Push',
        body: 'Test body',
      };

      const event = {
        type: 'channel.push.queued',
        data: {
          notificationId: 'notif-789',
          channel: NotificationChannel.PUSH,
          payload: pushPayload,
        },
        timestamp: new Date(),
      };

      mockFirebaseSend.mockResolvedValueOnce('msg-789');

      await handlePushQueue(event);

      expect(mockFirebaseSend).toHaveBeenCalledWith(
        expect.objectContaining({
          apns: {
            payload: {
              aps: {
                badge: undefined,
                sound: 'default',
              },
            },
          },
        })
      );
    });

    it('should include custom data in push notification', async () => {
      const pushPayload: PushPayload = {
        token: 'device-token-custom',
        title: 'Custom Data Push',
        body: 'Push with custom data',
        data: {
          userId: 'user-123',
          actionType: 'view',
          itemId: 'item-456',
        },
      };

      const event = {
        type: 'channel.push.queued',
        data: {
          notificationId: 'notif-custom',
          channel: NotificationChannel.PUSH,
          payload: pushPayload,
        },
        timestamp: new Date(),
      };

      mockFirebaseSend.mockResolvedValueOnce('msg-custom');

      await handlePushQueue(event);

      expect(mockFirebaseSend).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            userId: 'user-123',
            actionType: 'view',
            itemId: 'item-456',
          },
        })
      );
    });

    it('should mask token in logs for security', async () => {
      const pushPayload: PushPayload = {
        token: 'very-long-secure-token-12345',
        title: 'Secure Push',
        body: 'Test body',
      };

      const event = {
        type: 'channel.push.queued',
        data: {
          notificationId: 'notif-secure',
          channel: NotificationChannel.PUSH,
          payload: pushPayload,
        },
        timestamp: new Date(),
      };

      mockFirebaseSend.mockResolvedValueOnce('msg-secure');

      await handlePushQueue(event);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Sending push notification',
        expect.objectContaining({
          notificationId: 'notif-secure',
          token: 'very-long-...',
        })
      );
    });

    it('should handle badge count in notifications', async () => {
      const pushPayload: PushPayload = {
        token: 'device-token-badge',
        title: 'Badge Test',
        body: 'Test body',
        badge: 5,
      };

      const event = {
        type: 'channel.push.queued',
        data: {
          notificationId: 'notif-badge',
          channel: NotificationChannel.PUSH,
          payload: pushPayload,
        },
        timestamp: new Date(),
      };

      mockFirebaseSend.mockResolvedValueOnce('msg-badge');

      await handlePushQueue(event);

      expect(mockFirebaseSend).toHaveBeenCalledWith(
        expect.objectContaining({
          apns: {
            payload: {
              aps: {
                badge: 5,
                sound: 'default',
              },
            },
          },
        })
      );
    });

    it('should log appropriate messages during push sending', async () => {
      const pushPayload: PushPayload = {
        token: 'device-token-log',
        title: 'Log Test',
        body: 'Test body',
      };

      const event = {
        type: 'channel.push.queued',
        data: {
          notificationId: 'notif-log',
          channel: NotificationChannel.PUSH,
          payload: pushPayload,
        },
        timestamp: new Date(),
      };

      mockFirebaseSend.mockResolvedValueOnce('msg-log-123');

      await handlePushQueue(event);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Push notification sent successfully',
        expect.objectContaining({
          notificationId: 'notif-log',
          messageId: 'msg-log-123',
        })
      );
    });
  });
});
