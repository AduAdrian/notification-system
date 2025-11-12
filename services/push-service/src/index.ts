import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { createLogger, KafkaClient } from '@notification-system/utils';
import { PushPayload, NotificationChannel } from '@notification-system/types';

dotenv.config();

const logger = createLogger('push-service');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const kafkaClient = new KafkaClient(
  (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  'push-service'
);

async function handlePushQueue(event: any): Promise<void> {
  const { data } = event;
  const { notificationId, payload } = data;
  const pushPayload = payload as PushPayload;

  try {
    logger.info('Sending push notification', {
      notificationId,
      token: pushPayload.token.substring(0, 10) + '...',
    });

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

    await kafkaClient.publishEvent('push.sent', {
      type: 'channel.push.sent',
      data: {
        notificationId,
        channel: NotificationChannel.PUSH,
        providerId: message,
      },
      timestamp: new Date(),
    });

    logger.info('Push notification sent successfully', {
      notificationId,
      messageId: message,
    });
  } catch (error: any) {
    logger.error('Failed to send push notification', {
      notificationId,
      error: error.message,
    });

    await kafkaClient.publishEvent('delivery.failed', {
      type: 'delivery.failed',
      data: {
        notificationId,
        channel: NotificationChannel.PUSH,
        error: error.message,
      },
      timestamp: new Date(),
    });
  }
}

async function start() {
  try {
    await kafkaClient.subscribe(
      'push-service-group',
      ['channel.push.queued'],
      handlePushQueue
    );

    logger.info('Push Service started and listening for events');
  } catch (error) {
    logger.error('Failed to start Push Service', { error });
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down');
  await kafkaClient.disconnect();
  process.exit(0);
});

start();
