// IMPORTANT: Initialize tracing FIRST, before any other imports
import { initTracing , correlationMiddleware } from '@notification-system/utils';
initTracing({
  serviceName: 'sms-service',
  environment: process.env.NODE_ENV || 'development',
});

import dotenv from 'dotenv';
import express from 'express';
import twilio from 'twilio';
import {
  createLogger,
  KafkaClientWithDLQ,
  MetricsCollector,
  createTimer,
  createHttpCircuitBreaker,
  withSpan,
  addSpanEvent,
, correlationMiddleware } from '@notification-system/utils';
import { SMSPayload, NotificationChannel } from '@notification-system/types';

dotenv.config();

const logger = createLogger('sms-service');
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Initialize metrics
const metrics = new MetricsCollector('sms-service');

// Setup HTTP server for metrics endpoint
const app = express();
app.use(express.json());
app.use(correlationMiddleware);
const METRICS_PORT = process.env.METRICS_PORT || 3003;

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
    // Check if Twilio credentials are configured
    const twilioConfigured = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    const responseTime = Date.now() - startTime;

    const status = twilioConfigured ? 'healthy' : 'degraded';

    res.status(twilioConfigured ? 200 : 503).json({
      status,
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      checks: {
        kafka: 'up',
        twilio: twilioConfigured ? 'up' : 'down',
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
    service: 'sms-service',
    timestamp: new Date().toISOString(),
    checks: {
      kafka: 'up',
      twilio: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) ? 'up' : 'down',
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
  'sms-service',
  {
    enabled: true,
    maxRetries: 3,
    retryDelayMs: 1000,
    dlqTopicSuffix: '.dlq',
    metrics,
  }
);

// Create circuit breaker for Twilio API
const sendSMSWithCircuitBreaker = createHttpCircuitBreaker(
  'twilio-api',
  async (smsData: { body: string; from: string; to: string }) => {
    return await twilioClient.messages.create(smsData);
  },
  metrics
);

async function handleSMSQueue(event: any): Promise<void> {
  return withSpan('sms-delivery', async () => {
    const { data } = event;
    const { notificationId, payload } = data;
    const smsPayload = payload as SMSPayload;

    // Start timer for latency tracking
    const endTimer = createTimer();

    addSpanEvent('sms-handler-start', {
      'notification.id': notificationId,
      'sms.to': smsPayload.to,
    });

    try {
      logger.info('Sending SMS', {
        notificationId,
        to: smsPayload.to,
      });

      // Use circuit breaker to send SMS
      const message = await sendSMSWithCircuitBreaker({
        body: smsPayload.message,
        from: smsPayload.from,
        to: smsPayload.to,
      });

      // Track successful delivery
      const duration = endTimer();
      metrics.trackNotificationDelivery(
        NotificationChannel.SMS,
        'success',
        'twilio',
        duration
      );

      addSpanEvent('sms-sent-success', {
        'notification.id': notificationId,
        'message.sid': message.sid,
        'duration.seconds': duration.toString(),
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
        duration,
      });
    } catch (error: any) {
      // Track failed delivery
      const duration = endTimer();
      metrics.trackNotificationDelivery(
        NotificationChannel.SMS,
        'failed',
        'twilio',
        duration
      );

      addSpanEvent('sms-sent-failed', {
        'notification.id': notificationId,
        'error.message': error.message,
        'error.type': error.name,
      });

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

      // Re-throw to trigger DLQ retry logic
      throw error;
    }
  });
}

async function start() {
  try {
    // Start metrics server
    app.listen(METRICS_PORT, () => {
      logger.info(`SMS Service metrics available on port ${METRICS_PORT}`);
    });

    // Update Kafka connection status
    metrics.updateKafkaConnectionStatus(true);

    await kafkaClient.subscribe(
      'sms-service-group',
      ['channel.sms.queued'],
      handleSMSQueue
    );

    logger.info('SMS Service started and listening for events');
  } catch (error) {
    logger.error('Failed to start SMS Service', { error });
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
