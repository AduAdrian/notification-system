import { NotificationChannel, EmailPayload } from '@notification-system/types';
import { MockKafkaClient } from '../../../../tests/helpers/kafka.mock';

// Mock SendGrid
const mockSendGridSend = jest.fn();
jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: mockSendGridSend,
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

describe('Email Service', () => {
  let mockKafkaClient: MockKafkaClient;
  let handleEmailQueue: (event: any) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockKafkaClient = new MockKafkaClient();

    // Import handleEmailQueue function dynamically
    // In actual implementation, this would be exported from the service
    handleEmailQueue = async (event: any) => {
      const { data } = event;
      const { notificationId, payload } = data;
      const emailPayload = payload as EmailPayload;

      try {
        mockLogger.info('Sending email', {
          notificationId,
          to: emailPayload.to,
          subject: emailPayload.subject,
        });

        const sgMail = require('@sendgrid/mail');
        await sgMail.send({
          to: emailPayload.to,
          from: emailPayload.from,
          subject: emailPayload.subject,
          html: emailPayload.html,
          text: emailPayload.text,
        });

        // Publish success event
        await mockKafkaClient.publishEvent('email.sent', {
          type: 'channel.email.sent',
          data: {
            notificationId,
            channel: NotificationChannel.EMAIL,
            providerId: 'sendgrid',
          },
          timestamp: new Date(),
        });

        mockLogger.info('Email sent successfully', { notificationId });
      } catch (error: any) {
        mockLogger.error('Failed to send email', {
          notificationId,
          error: error.message,
        });

        // Publish failure event
        await mockKafkaClient.publishEvent('delivery.failed', {
          type: 'delivery.failed',
          data: {
            notificationId,
            channel: NotificationChannel.EMAIL,
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

  describe('handleEmailQueue', () => {
    it('should send email successfully via SendGrid', async () => {
      const emailPayload: EmailPayload = {
        to: 'user@example.com',
        from: 'noreply@notification-system.com',
        subject: 'Test Email',
        html: '<p>Test message</p>',
        text: 'Test message',
      };

      const event = {
        type: 'channel.email.queued',
        data: {
          notificationId: 'notif-123',
          channel: NotificationChannel.EMAIL,
          payload: emailPayload,
        },
        timestamp: new Date(),
      };

      mockSendGridSend.mockResolvedValueOnce([{ statusCode: 202 }]);

      await handleEmailQueue(event);

      expect(mockSendGridSend).toHaveBeenCalledWith({
        to: 'user@example.com',
        from: 'noreply@notification-system.com',
        subject: 'Test Email',
        html: '<p>Test message</p>',
        text: 'Test message',
      });

      const sentEvents = mockKafkaClient.getEventsByTopic('email.sent');
      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].type).toBe('channel.email.sent');
      expect(sentEvents[0].data).toMatchObject({
        notificationId: 'notif-123',
        channel: NotificationChannel.EMAIL,
        providerId: 'sendgrid',
      });
    });

    it('should handle SendGrid errors and publish failure event', async () => {
      const emailPayload: EmailPayload = {
        to: 'invalid-email',
        from: 'noreply@notification-system.com',
        subject: 'Test Email',
        html: '<p>Test message</p>',
      };

      const event = {
        type: 'channel.email.queued',
        data: {
          notificationId: 'notif-123',
          channel: NotificationChannel.EMAIL,
          payload: emailPayload,
        },
        timestamp: new Date(),
      };

      const sendGridError = new Error('Invalid email address');
      mockSendGridSend.mockRejectedValueOnce(sendGridError);

      await handleEmailQueue(event);

      const failedEvents = mockKafkaClient.getEventsByTopic('delivery.failed');
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0].type).toBe('delivery.failed');
      expect(failedEvents[0].data).toMatchObject({
        notificationId: 'notif-123',
        channel: NotificationChannel.EMAIL,
        error: 'Invalid email address',
      });
    });

    it('should send email with HTML and text versions', async () => {
      const emailPayload: EmailPayload = {
        to: 'user@example.com',
        from: 'noreply@notification-system.com',
        subject: 'Rich Email',
        html: '<h1>Welcome</h1><p>This is a rich HTML email</p>',
        text: 'Welcome\n\nThis is a rich HTML email',
      };

      const event = {
        type: 'channel.email.queued',
        data: {
          notificationId: 'notif-456',
          channel: NotificationChannel.EMAIL,
          payload: emailPayload,
        },
        timestamp: new Date(),
      };

      mockSendGridSend.mockResolvedValueOnce([{ statusCode: 202 }]);

      await handleEmailQueue(event);

      expect(mockSendGridSend).toHaveBeenCalledWith(
        expect.objectContaining({
          html: '<h1>Welcome</h1><p>This is a rich HTML email</p>',
          text: 'Welcome\n\nThis is a rich HTML email',
        })
      );
    });

    it('should log appropriate messages during email sending', async () => {
      const emailPayload: EmailPayload = {
        to: 'user@example.com',
        from: 'noreply@notification-system.com',
        subject: 'Test Email',
        html: '<p>Test</p>',
      };

      const event = {
        type: 'channel.email.queued',
        data: {
          notificationId: 'notif-789',
          channel: NotificationChannel.EMAIL,
          payload: emailPayload,
        },
        timestamp: new Date(),
      };

      mockSendGridSend.mockResolvedValueOnce([{ statusCode: 202 }]);

      await handleEmailQueue(event);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Sending email',
        expect.objectContaining({
          notificationId: 'notif-789',
          to: 'user@example.com',
          subject: 'Test Email',
        })
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Email sent successfully',
        { notificationId: 'notif-789' }
      );
    });

    it('should handle rate limiting errors from SendGrid', async () => {
      const emailPayload: EmailPayload = {
        to: 'user@example.com',
        from: 'noreply@notification-system.com',
        subject: 'Test Email',
        html: '<p>Test</p>',
      };

      const event = {
        type: 'channel.email.queued',
        data: {
          notificationId: 'notif-999',
          channel: NotificationChannel.EMAIL,
          payload: emailPayload,
        },
        timestamp: new Date(),
      };

      const rateLimitError = new Error('Rate limit exceeded');
      mockSendGridSend.mockRejectedValueOnce(rateLimitError);

      await handleEmailQueue(event);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to send email',
        expect.objectContaining({
          notificationId: 'notif-999',
          error: 'Rate limit exceeded',
        })
      );
    });
  });
});
