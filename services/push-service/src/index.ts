// IMPORTANT: Initialize tracing FIRST, before any other imports
import { initTracing } from '@notification-system/utils';
initTracing({
  serviceName: 'push-service',
  environment: process.env.NODE_ENV || 'development',
});

import dotenv from 'dotenv';
import express from 'express';
import admin from 'firebase-admin';
import {
  createLogger,
  KafkaClientWithDLQ,
  MetricsCollector,
  createTimer,
  createHttpCircuitBreaker,
  withSpan,
  addSpanEvent,
} from '@notification-system/utils';
import { PushPayload, NotificationChannel } from '@notification-system/types';

dotenv.config();

const logger = createLogger('push-service');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

// Initialize metrics
const metrics = new MetricsCollector('push-service');

// Setup HTTP server for metrics endpoint
const app = express();
const METRICS_PORT = process.env.METRICS_PORT || 3005;

// Liveness probe - Simple, fast check if process is running
app.get('/health/live', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Readiness probe - Checks if service can handle requests
app.get('/health/ready', async (req, res) => {
  const startTime = Date.now();

  try {
    const responseTime = Date.now() - startTime;

    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      checks: {
        kafka: 'up',
        firebase: 'up',
      },
      uptime: process.uptime(),
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      error: 'Readiness check failed',
    });
  }
});

// Startup probe - Allows slow initialization
app.get('/health/startup', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

// Legacy health endpoint - kept for backward compatibility
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'push-service',
    timestamp: new Date().toISOString(),
    checks: {
      kafka: 'up',
      firebase: 'up',
    },
    uptime: process.uptime(),
  });
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', metrics.getRegistry().contentType);
    res.end(await metrics.getMetrics());
  } catch (error) {
    logger.error('Failed to collect metrics', { error });
    res.status(500).end();
  }
});

// Initialize Kafka client with DLQ support
const kafkaClient = new KafkaClientWithDLQ(
  (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  'push-service',
  {
    enabled: true,
    maxRetries: 3,
    retryDelayMs: 1000,
    dlqTopicSuffix: '.dlq',
    metrics,
  }
);

// Create circuit breaker for Firebase Cloud Messaging API
const sendPushWithCircuitBreaker = createHttpCircuitBreaker(
  'firebase-messaging-api',
  async (message: any) => {
    return await admin.messaging().send(message);
  },
  metrics
);

async function handlePushQueue(event: any): Promise<void> {
  return withSpan('push-delivery', async () => {
    const { data } = event;
    const { notificationId, payload } = data;
    const pushPayload = payload as PushPayload;

    // Start timer for latency tracking
    const endTimer = createTimer();

    addSpanEvent('push-handler-start', {
      'notification.id': notificationId,
      'push.token': pushPayload.token.substring(0, 10) + '...',
    });

    try {
      logger.info('Sending push notification', {
        notificationId,
        token: pushPayload.token.substring(0, 10) + '...',
      });

      // Use circuit breaker to send push notification
      const message = await sendPushWithCircuitBreaker({
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

      // Track successful delivery
      const duration = endTimer();
      metrics.trackNotificationDelivery(
        NotificationChannel.PUSH,
        'success',
        'firebase',
        duration
      );

      addSpanEvent('push-sent-success', {
        'notification.id': notificationId,
        'message.id': message,
        'duration.seconds': duration.toString(),
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
        duration,
      });
    } catch (error: any) {
      // Track failed delivery
      const duration = endTimer();
      metrics.trackNotificationDelivery(
        NotificationChannel.PUSH,
        'failed',
        'firebase',
        duration
      );

      addSpanEvent('push-sent-failed', {
        'notification.id': notificationId,
        'error.message': error.message,
        'error.type': error.name,
      });

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

      // Re-throw to trigger DLQ retry logic
      throw error;
    }
  });
}

async function start() {
  try {
    // Start metrics server
    app.listen(METRICS_PORT, () => {
      logger.info(`Push Service metrics available on port ${METRICS_PORT}`);
    });

    // Update Kafka connection status
    metrics.updateKafkaConnectionStatus(true);

    await kafkaClient.subscribe(
      'push-service-group',
      ['channel.push.queued'],
      handlePushQueue
    );

    logger.info('Push Service started and listening for events');
  } catch (error) {
    logger.error('Failed to start Push Service', { error });
    metrics.updateKafkaConnectionStatus(false);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down');
  metrics.updateKafkaConnectionStatus(false);
  await kafkaClient.disconnect();
  process.exit(0);
});

start();
