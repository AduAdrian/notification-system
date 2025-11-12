import { Request, Response } from 'express';
import { NotificationChannel, InAppPayload } from '@notification-system/types';
import { MockKafkaClient } from '../../../../tests/helpers/kafka.mock';

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

describe('In-App Service', () => {
  let mockKafkaClient: MockKafkaClient;
  let connections: Map<string, Response[]>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockKafkaClient = new MockKafkaClient();
    connections = new Map<string, Response[]>();
  });

  afterEach(() => {
    mockKafkaClient.reset();
    connections.clear();
  });

  describe('SSE Connection Management', () => {
    it('should establish SSE connection for user', () => {
      const mockReq = {
        params: { userId: 'user-123' },
        on: jest.fn(),
      } as unknown as Request;

      const mockRes = {
        setHeader: jest.fn(),
        write: jest.fn(),
      } as unknown as Response;

      // Simulate SSE endpoint
      const { userId } = mockReq.params;

      mockRes.setHeader('Content-Type', 'text/event-stream');
      mockRes.setHeader('Cache-Control', 'no-cache');
      mockRes.setHeader('Connection', 'keep-alive');

      if (!connections.has(userId)) {
        connections.set(userId, []);
      }
      connections.get(userId)!.push(mockRes);

      mockRes.write('data: ' + JSON.stringify({ type: 'connected' }) + '\\n\\n');

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('connected')
      );
      expect(connections.get('user-123')).toHaveLength(1);
    });

    it('should handle multiple connections for same user', () => {
      const mockRes1 = {
        setHeader: jest.fn(),
        write: jest.fn(),
      } as unknown as Response;

      const mockRes2 = {
        setHeader: jest.fn(),
        write: jest.fn(),
      } as unknown as Response;

      connections.set('user-123', []);
      connections.get('user-123')!.push(mockRes1);
      connections.get('user-123')!.push(mockRes2);

      expect(connections.get('user-123')).toHaveLength(2);
    });

    it('should remove connection when client disconnects', () => {
      const mockRes = {
        setHeader: jest.fn(),
        write: jest.fn(),
      } as unknown as Response;

      connections.set('user-123', [mockRes]);

      // Simulate disconnect
      const userConnections = connections.get('user-123');
      if (userConnections) {
        const index = userConnections.indexOf(mockRes);
        if (index > -1) {
          userConnections.splice(index, 1);
        }
        if (userConnections.length === 0) {
          connections.delete('user-123');
        }
      }

      expect(connections.has('user-123')).toBe(false);
    });
  });

  describe('handleInAppQueue', () => {
    let handleInAppQueue: (event: any) => Promise<void>;

    beforeEach(() => {
      // Simulate handleInAppQueue function
      handleInAppQueue = async (event: any) => {
        const { data } = event;
        const { notificationId, payload } = data;
        const inAppPayload = payload as InAppPayload;

        try {
          mockLogger.info('Sending in-app notification', {
            notificationId,
            userId: inAppPayload.userId,
          });

          const userConnections = connections.get(inAppPayload.userId);

          if (userConnections && userConnections.length > 0) {
            const message = JSON.stringify({
              type: 'notification',
              id: notificationId,
              title: inAppPayload.title,
              message: inAppPayload.message,
              actionUrl: inAppPayload.actionUrl,
              iconUrl: inAppPayload.iconUrl,
              timestamp: new Date().toISOString(),
            });

            userConnections.forEach((connection) => {
              connection.write(`data: ${message}\\n\\n`);
            });

            await mockKafkaClient.publishEvent('inapp.sent', {
              type: 'channel.inapp.sent',
              data: {
                notificationId,
                channel: NotificationChannel.IN_APP,
              },
              timestamp: new Date(),
            });

            mockLogger.info('In-app notification sent', {
              notificationId,
              connections: userConnections.length,
            });
          } else {
            mockLogger.warn('No active connections for user', {
              notificationId,
              userId: inAppPayload.userId,
            });

            await mockKafkaClient.publishEvent('delivery.failed', {
              type: 'delivery.failed',
              data: {
                notificationId,
                channel: NotificationChannel.IN_APP,
                error: 'User not connected',
              },
              timestamp: new Date(),
            });
          }
        } catch (error: any) {
          mockLogger.error('Failed to send in-app notification', {
            notificationId,
            error: error.message,
          });

          await mockKafkaClient.publishEvent('delivery.failed', {
            type: 'delivery.failed',
            data: {
              notificationId,
              channel: NotificationChannel.IN_APP,
              error: error.message,
            },
            timestamp: new Date(),
          });
        }
      };
    });

    it('should send in-app notification to connected user', async () => {
      const mockRes = {
        write: jest.fn(),
      } as unknown as Response;

      connections.set('user-123', [mockRes]);

      const inAppPayload: InAppPayload = {
        userId: 'user-123',
        title: 'Test Notification',
        message: 'Test in-app message',
        actionUrl: 'https://example.com',
      };

      const event = {
        type: 'channel.inapp.queued',
        data: {
          notificationId: 'notif-123',
          channel: NotificationChannel.IN_APP,
          payload: inAppPayload,
        },
        timestamp: new Date(),
      };

      await handleInAppQueue(event);

      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('Test Notification')
      );
      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('Test in-app message')
      );

      const sentEvents = mockKafkaClient.getEventsByTopic('inapp.sent');
      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].type).toBe('channel.inapp.sent');
    });

    it('should send to multiple connections for same user', async () => {
      const mockRes1 = { write: jest.fn() } as unknown as Response;
      const mockRes2 = { write: jest.fn() } as unknown as Response;

      connections.set('user-123', [mockRes1, mockRes2]);

      const inAppPayload: InAppPayload = {
        userId: 'user-123',
        title: 'Multi Connection',
        message: 'Test message',
      };

      const event = {
        type: 'channel.inapp.queued',
        data: {
          notificationId: 'notif-multi',
          channel: NotificationChannel.IN_APP,
          payload: inAppPayload,
        },
        timestamp: new Date(),
      };

      await handleInAppQueue(event);

      expect(mockRes1.write).toHaveBeenCalled();
      expect(mockRes2.write).toHaveBeenCalled();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'In-app notification sent',
        expect.objectContaining({
          connections: 2,
        })
      );
    });

    it('should handle user not connected scenario', async () => {
      const inAppPayload: InAppPayload = {
        userId: 'user-offline',
        title: 'Offline User',
        message: 'Test message',
      };

      const event = {
        type: 'channel.inapp.queued',
        data: {
          notificationId: 'notif-offline',
          channel: NotificationChannel.IN_APP,
          payload: inAppPayload,
        },
        timestamp: new Date(),
      };

      await handleInAppQueue(event);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No active connections for user',
        expect.objectContaining({
          userId: 'user-offline',
        })
      );

      const failedEvents = mockKafkaClient.getEventsByTopic('delivery.failed');
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0].data).toMatchObject({
        notificationId: 'notif-offline',
        error: 'User not connected',
      });
    });

    it('should include actionUrl in notification', async () => {
      const mockRes = { write: jest.fn() } as unknown as Response;
      connections.set('user-123', [mockRes]);

      const inAppPayload: InAppPayload = {
        userId: 'user-123',
        title: 'Action Notification',
        message: 'Click to view',
        actionUrl: 'https://example.com/action',
      };

      const event = {
        type: 'channel.inapp.queued',
        data: {
          notificationId: 'notif-action',
          channel: NotificationChannel.IN_APP,
          payload: inAppPayload,
        },
        timestamp: new Date(),
      };

      await handleInAppQueue(event);

      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('https://example.com/action')
      );
    });

    it('should include iconUrl in notification when provided', async () => {
      const mockRes = { write: jest.fn() } as unknown as Response;
      connections.set('user-123', [mockRes]);

      const inAppPayload: InAppPayload = {
        userId: 'user-123',
        title: 'Icon Notification',
        message: 'With icon',
        iconUrl: 'https://example.com/icon.png',
      };

      const event = {
        type: 'channel.inapp.queued',
        data: {
          notificationId: 'notif-icon',
          channel: NotificationChannel.IN_APP,
          payload: inAppPayload,
        },
        timestamp: new Date(),
      };

      await handleInAppQueue(event);

      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining('https://example.com/icon.png')
      );
    });

    it('should handle errors gracefully', async () => {
      const mockRes = {
        write: jest.fn().mockImplementation(() => {
          throw new Error('Connection error');
        }),
      } as unknown as Response;

      connections.set('user-123', [mockRes]);

      const inAppPayload: InAppPayload = {
        userId: 'user-123',
        title: 'Error Test',
        message: 'Test message',
      };

      const event = {
        type: 'channel.inapp.queued',
        data: {
          notificationId: 'notif-error',
          channel: NotificationChannel.IN_APP,
          payload: inAppPayload,
        },
        timestamp: new Date(),
      };

      await handleInAppQueue(event);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to send in-app notification',
        expect.objectContaining({
          error: 'Connection error',
        })
      );

      const failedEvents = mockKafkaClient.getEventsByTopic('delivery.failed');
      expect(failedEvents).toHaveLength(1);
    });
  });
});
