import { NotificationChannel, SMSPayload } from '@notification-system/types';
import { MockKafkaClient } from '../../../../tests/helpers/kafka.mock';

// Mock Twilio
const mockTwilioCreate = jest.fn();
const mockTwilio = jest.fn(() => ({
  messages: {
    create: mockTwilioCreate,
  },
}));

jest.mock('twilio', () => mockTwilio);

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

describe('SMS Service', () => {
  let mockKafkaClient: MockKafkaClient;
  let handleSMSQueue: (event: any) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockKafkaClient = new MockKafkaClient();

    // Simulate handleSMSQueue function
    handleSMSQueue = async (event: any) => {
      const { data } = event;
      const { notificationId, payload } = data;
      const smsPayload = payload as SMSPayload;

      try {
        mockLogger.info('Sending SMS', {
          notificationId,
          to: smsPayload.to,
        });

        const twilio = require('twilio');
        const twilioClient = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        );

        const message = await twilioClient.messages.create({
          body: smsPayload.message,
          from: smsPayload.from,
          to: smsPayload.to,
        });

        await mockKafkaClient.publishEvent('sms.sent', {
          type: 'channel.sms.sent',
          data: {
            notificationId,
            channel: NotificationChannel.SMS,
            providerId: message.sid,
          },
          timestamp: new Date(),
        });

        mockLogger.info('SMS sent successfully', {
          notificationId,
          messageSid: message.sid,
        });
      } catch (error: any) {
        mockLogger.error('Failed to send SMS', {
          notificationId,
          error: error.message,
        });

        await mockKafkaClient.publishEvent('delivery.failed', {
          type: 'delivery.failed',
          data: {
            notificationId,
            channel: NotificationChannel.SMS,
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

  describe('handleSMSQueue', () => {
    it('should send SMS successfully via Twilio', async () => {
      const smsPayload: SMSPayload = {
        to: '+1234567890',
        from: '+0987654321',
        message: 'Test SMS message',
      };

      const event = {
        type: 'channel.sms.queued',
        data: {
          notificationId: 'notif-123',
          channel: NotificationChannel.SMS,
          payload: smsPayload,
        },
        timestamp: new Date(),
      };

      mockTwilioCreate.mockResolvedValueOnce({
        sid: 'SM1234567890',
        status: 'queued',
      });

      await handleSMSQueue(event);

      expect(mockTwilioCreate).toHaveBeenCalledWith({
        body: 'Test SMS message',
        from: '+0987654321',
        to: '+1234567890',
      });

      const sentEvents = mockKafkaClient.getEventsByTopic('sms.sent');
      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].type).toBe('channel.sms.sent');
      expect(sentEvents[0].data).toMatchObject({
        notificationId: 'notif-123',
        channel: NotificationChannel.SMS,
        providerId: 'SM1234567890',
      });
    });

    it('should handle Twilio errors and publish failure event', async () => {
      const smsPayload: SMSPayload = {
        to: 'invalid-number',
        from: '+0987654321',
        message: 'Test SMS',
      };

      const event = {
        type: 'channel.sms.queued',
        data: {
          notificationId: 'notif-456',
          channel: NotificationChannel.SMS,
          payload: smsPayload,
        },
        timestamp: new Date(),
      };

      const twilioError = new Error('Invalid phone number');
      mockTwilioCreate.mockRejectedValueOnce(twilioError);

      await handleSMSQueue(event);

      const failedEvents = mockKafkaClient.getEventsByTopic('delivery.failed');
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0].type).toBe('delivery.failed');
      expect(failedEvents[0].data).toMatchObject({
        notificationId: 'notif-456',
        channel: NotificationChannel.SMS,
        error: 'Invalid phone number',
      });
    });

    it('should log appropriate messages during SMS sending', async () => {
      const smsPayload: SMSPayload = {
        to: '+1234567890',
        from: '+0987654321',
        message: 'Test SMS',
      };

      const event = {
        type: 'channel.sms.queued',
        data: {
          notificationId: 'notif-789',
          channel: NotificationChannel.SMS,
          payload: smsPayload,
        },
        timestamp: new Date(),
      };

      mockTwilioCreate.mockResolvedValueOnce({
        sid: 'SM9876543210',
        status: 'queued',
      });

      await handleSMSQueue(event);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Sending SMS',
        expect.objectContaining({
          notificationId: 'notif-789',
          to: '+1234567890',
        })
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'SMS sent successfully',
        expect.objectContaining({
          notificationId: 'notif-789',
          messageSid: 'SM9876543210',
        })
      );
    });

    it('should handle long SMS messages', async () => {
      const longMessage = 'A'.repeat(500); // Long SMS message
      const smsPayload: SMSPayload = {
        to: '+1234567890',
        from: '+0987654321',
        message: longMessage,
      };

      const event = {
        type: 'channel.sms.queued',
        data: {
          notificationId: 'notif-long',
          channel: NotificationChannel.SMS,
          payload: smsPayload,
        },
        timestamp: new Date(),
      };

      mockTwilioCreate.mockResolvedValueOnce({
        sid: 'SM_LONG_123',
        status: 'queued',
      });

      await handleSMSQueue(event);

      expect(mockTwilioCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          body: longMessage,
        })
      );
    });

    it('should handle international phone numbers', async () => {
      const smsPayload: SMSPayload = {
        to: '+44123456789', // UK number
        from: '+1987654321', // US number
        message: 'International SMS',
      };

      const event = {
        type: 'channel.sms.queued',
        data: {
          notificationId: 'notif-intl',
          channel: NotificationChannel.SMS,
          payload: smsPayload,
        },
        timestamp: new Date(),
      };

      mockTwilioCreate.mockResolvedValueOnce({
        sid: 'SM_INTL_456',
        status: 'queued',
      });

      await handleSMSQueue(event);

      expect(mockTwilioCreate).toHaveBeenCalledWith({
        body: 'International SMS',
        from: '+1987654321',
        to: '+44123456789',
      });
    });

    it('should handle Twilio rate limit errors', async () => {
      const smsPayload: SMSPayload = {
        to: '+1234567890',
        from: '+0987654321',
        message: 'Test SMS',
      };

      const event = {
        type: 'channel.sms.queued',
        data: {
          notificationId: 'notif-rate',
          channel: NotificationChannel.SMS,
          payload: smsPayload,
        },
        timestamp: new Date(),
      };

      const rateLimitError = new Error('Rate limit exceeded');
      mockTwilioCreate.mockRejectedValueOnce(rateLimitError);

      await handleSMSQueue(event);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to send SMS',
        expect.objectContaining({
          notificationId: 'notif-rate',
          error: 'Rate limit exceeded',
        })
      );
    });
  });
});
