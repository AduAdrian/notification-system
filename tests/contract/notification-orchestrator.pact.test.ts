import { Pact, Matchers } from '@pact-foundation/pact';
import path from 'path';
import {
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
} from '@notification-system/types';

const { like, term, iso8601DateTime } = Matchers;

describe('Notification Service -> Channel Orchestrator Contract', () => {
  const provider = new Pact({
    consumer: 'notification-service',
    provider: 'channel-orchestrator',
    port: 8990,
    log: path.resolve(process.cwd(), 'logs', 'pact.log'),
    dir: path.resolve(process.cwd(), 'pacts'),
    logLevel: 'warn',
  });

  beforeAll(() => provider.setup());
  afterEach(() => provider.verify());
  afterAll(() => provider.finalize());

  describe('Publishing notification.created event', () => {
    it('should publish a valid notification created event', async () => {
      await provider.addInteraction({
        state: 'notification service has created a notification',
        uponReceiving: 'a notification.created event',
        withRequest: {
          method: 'POST',
          path: '/events/notification.created',
          headers: {
            'Content-Type': 'application/json',
          },
          body: {
            type: 'notification.created',
            data: {
              id: like('notif-123'),
              userId: like('user-123'),
              channels: like([NotificationChannel.EMAIL]),
              priority: term({
                matcher: 'low|medium|high|urgent',
                generate: NotificationPriority.MEDIUM,
              }),
              status: term({
                matcher: 'pending|queued|sent|delivered|failed|bounced',
                generate: NotificationStatus.PENDING,
              }),
              subject: like('Test Subject'),
              message: like('Test message'),
              metadata: like({}),
              createdAt: iso8601DateTime(),
              updatedAt: iso8601DateTime(),
            },
            timestamp: iso8601DateTime(),
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
          body: {
            success: true,
            message: like('Event received'),
          },
        },
      });

      // Test implementation would go here
      // This is a contract definition test
    });

    it('should handle email channel routing', async () => {
      await provider.addInteraction({
        state: 'orchestrator can route email notifications',
        uponReceiving: 'a notification with EMAIL channel',
        withRequest: {
          method: 'POST',
          path: '/events/notification.created',
          headers: {
            'Content-Type': 'application/json',
          },
          body: {
            type: 'notification.created',
            data: {
              id: like('notif-email-123'),
              userId: like('user-123'),
              channels: [NotificationChannel.EMAIL],
              priority: NotificationPriority.MEDIUM,
              status: NotificationStatus.PENDING,
              subject: like('Email Test'),
              message: like('Email test message'),
              metadata: like({}),
              createdAt: iso8601DateTime(),
              updatedAt: iso8601DateTime(),
            },
            timestamp: iso8601DateTime(),
          },
        },
        willRespondWith: {
          status: 200,
          body: {
            success: true,
            routedChannels: like(['email']),
          },
        },
      });
    });

    it('should handle multi-channel routing', async () => {
      await provider.addInteraction({
        state: 'orchestrator can route to multiple channels',
        uponReceiving: 'a notification with multiple channels',
        withRequest: {
          method: 'POST',
          path: '/events/notification.created',
          headers: {
            'Content-Type': 'application/json',
          },
          body: {
            type: 'notification.created',
            data: {
              id: like('notif-multi-123'),
              userId: like('user-123'),
              channels: [
                NotificationChannel.EMAIL,
                NotificationChannel.SMS,
                NotificationChannel.PUSH,
              ],
              priority: NotificationPriority.HIGH,
              status: NotificationStatus.PENDING,
              message: like('Multi-channel message'),
              metadata: like({}),
              createdAt: iso8601DateTime(),
              updatedAt: iso8601DateTime(),
            },
            timestamp: iso8601DateTime(),
          },
        },
        willRespondWith: {
          status: 200,
          body: {
            success: true,
            routedChannels: like(['email', 'sms', 'push']),
          },
        },
      });
    });
  });
});
