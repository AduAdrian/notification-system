import dotenv from 'dotenv';
import sgMail from '@sendgrid/mail';
import { createLogger, KafkaClient } from '@notification-system/utils';
import { EmailPayload, NotificationChannel } from '@notification-system/types';

dotenv.config();

const logger = createLogger('email-service');
sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

const kafkaClient = new KafkaClient(
  (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  'email-service'
);

async function handleEmailQueue(event: any): Promise<void> {
  const { data } = event;
  const { notificationId, payload } = data;
  const emailPayload = payload as EmailPayload;

  try {
    logger.info('Sending email', {
      notificationId,
      to: emailPayload.to,
      subject: emailPayload.subject,
    });

    await sgMail.send({
      to: emailPayload.to,
      from: emailPayload.from,
      subject: emailPayload.subject,
      html: emailPayload.html,
      text: emailPayload.text,
    });

    // Publish success event
    await kafkaClient.publishEvent('email.sent', {
      type: 'channel.email.sent',
      data: {
        notificationId,
        channel: NotificationChannel.EMAIL,
        providerId: 'sendgrid',
      },
      timestamp: new Date(),
    });

    logger.info('Email sent successfully', { notificationId });
  } catch (error: any) {
    logger.error('Failed to send email', {
      notificationId,
      error: error.message,
    });

    // Publish failure event
    await kafkaClient.publishEvent('delivery.failed', {
      type: 'delivery.failed',
      data: {
        notificationId,
        channel: NotificationChannel.EMAIL,
        error: error.message,
      },
      timestamp: new Date(),
    });
  }
}

async function start() {
  try {
    await kafkaClient.subscribe(
      'email-service-group',
      ['channel.email.queued'],
      handleEmailQueue
    );

    logger.info('Email Service started and listening for events');
  } catch (error) {
    logger.error('Failed to start Email Service', { error });
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down');
  await kafkaClient.disconnect();
  process.exit(0);
});

start();
