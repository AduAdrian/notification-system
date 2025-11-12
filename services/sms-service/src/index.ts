import dotenv from 'dotenv';
import twilio from 'twilio';
import { createLogger, KafkaClient } from '@notification-system/utils';
import { SMSPayload, NotificationChannel } from '@notification-system/types';

dotenv.config();

const logger = createLogger('sms-service');
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const kafkaClient = new KafkaClient(
  (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  'sms-service'
);

async function handleSMSQueue(event: any): Promise<void> {
  const { data } = event;
  const { notificationId, payload } = data;
  const smsPayload = payload as SMSPayload;

  try {
    logger.info('Sending SMS', {
      notificationId,
      to: smsPayload.to,
    });

    const message = await twilioClient.messages.create({
      body: smsPayload.message,
      from: smsPayload.from,
      to: smsPayload.to,
    });

    await kafkaClient.publishEvent('sms.sent', {
      type: 'channel.sms.sent',
      data: {
        notificationId,
        channel: NotificationChannel.SMS,
        providerId: message.sid,
      },
      timestamp: new Date(),
    });

    logger.info('SMS sent successfully', {
      notificationId,
      messageSid: message.sid,
    });
  } catch (error: any) {
    logger.error('Failed to send SMS', {
      notificationId,
      error: error.message,
    });

    await kafkaClient.publishEvent('delivery.failed', {
      type: 'delivery.failed',
      data: {
        notificationId,
        channel: NotificationChannel.SMS,
        error: error.message,
      },
      timestamp: new Date(),
    });
  }
}

async function start() {
  try {
    await kafkaClient.subscribe(
      'sms-service-group',
      ['channel.sms.queued'],
      handleSMSQueue
    );

    logger.info('SMS Service started and listening for events');
  } catch (error) {
    logger.error('Failed to start SMS Service', { error });
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down');
  await kafkaClient.disconnect();
  process.exit(0);
});

start();
