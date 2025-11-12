import { Pact, Matchers } from '@pact-foundation/pact';
import path from 'path';
import { NotificationChannel } from '@notification-system/types';

const { like, iso8601DateTime } = Matchers;

describe('Channel Orchestrator -> Email Service Contract', () => {
  const provider = new Pact({
    consumer: 'channel-orchestrator',
    provider: 'email-service',
    port: 8991,
    log: path.resolve(process.cwd(), 'logs', 'pact.log'),
    dir: path.resolve(process.cwd(), 'pacts'),
    logLevel: 'warn',
  });

  beforeAll(() => provider.setup());
  afterEach(() => provider.verify());
  afterAll(() => provider.finalize());

  describe('Publishing channel.email.queued event', () => {
    it('should publish a valid email queued event', async () => {
      await provider.addInteraction({
        state: 'email service is ready to process emails',
        uponReceiving: 'a channel.email.queued event',
        withRequest: {
          method: 'POST',
          path: '/events/channel.email.queued',
          headers: {
            'Content-Type': 'application/json',
          },
          body: {
            type: 'channel.email.queued',
            data: {
              notificationId: like('notif-123'),
              channel: NotificationChannel.EMAIL,
              payload: {
                to: like('user@example.com'),
                from: like('noreply@notification-system.com'),
                subject: like('Test Email'),
                html: like('<p>Test content</p>'),
                text: like('Test content'),
              },
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
            message: like('Email queued for delivery'),
          },
        },
      });
    });

    it('should handle email with attachments', async () => {
      await provider.addInteraction({
        state: 'email service can handle attachments',
        uponReceiving: 'an email with attachments',
        withRequest: {
          method: 'POST',
          path: '/events/channel.email.queued',
          headers: {
            'Content-Type': 'application/json',
          },
          body: {
            type: 'channel.email.queued',
            data: {
              notificationId: like('notif-attach-123'),
              channel: NotificationChannel.EMAIL,
              payload: {
                to: like('user@example.com'),
                from: like('noreply@notification-system.com'),
                subject: like('Email with Attachment'),
                html: like('<p>See attached</p>'),
                text: like('See attached'),
                attachments: like([
                  {
                    filename: 'document.pdf',
                    content: 'base64-encoded-content',
                    contentType: 'application/pdf',
                  },
                ]),
              },
            },
            timestamp: iso8601DateTime(),
          },
        },
        willRespondWith: {
          status: 200,
          body: {
            success: true,
            message: like('Email with attachments queued'),
          },
        },
      });
    });
  });
});
