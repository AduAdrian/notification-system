// IMPORTANT: Initialize tracing FIRST, before any other imports
import { initTracing } from '@notification-system/utils';
initTracing({
  serviceName: 'email-service',
  environment: process.env.NODE_ENV || 'development',
});

import dotenv from 'dotenv';
import express from 'express';
import sgMail from '@sendgrid/mail';
import {
  createLogger,
  KafkaClientWithDLQ,
  MetricsCollector,
  createTimer,
  createHttpCircuitBreaker,
  withSpan,
  addSpanEvent,
} from '@notification-system/utils';
import { EmailPayload, NotificationChannel } from '@notification-system/types';

dotenv.config();

const logger = createLogger('email-service');
sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

// Initialize metrics
const metrics = new MetricsCollector('email-service');

// Setup HTTP server for metrics endpoint
const app = express();
const METRICS_PORT = process.env.METRICS_PORT || 3002;

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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'email-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Initialize Kafka client with DLQ support
const kafkaClient = new KafkaClientWithDLQ(
  (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  'email-service',
  {
    enabled: true,
    maxRetries: 3,
    retryDelayMs: 1000,
    dlqTopicSuffix: '.dlq',
    metrics,
  }
);

// Create circuit breaker for SendGrid API
const sendEmailWithCircuitBreaker = createHttpCircuitBreaker(
  'sendgrid-api',
  async (emailData: any) => {
    return await sgMail.send(emailData);
  },
  metrics
);

async function handleEmailQueue(event: any): Promise<void> {
  return withSpan('email-delivery', async () => {
    const { data } = event;
    const { notificationId, payload } = data;
    const emailPayload = payload as EmailPayload;

    // Start timer for latency tracking
    const endTimer = createTimer();

    addSpanEvent('email-handler-start', {
      'notification.id': notificationId,
      'email.to': emailPayload.to,
      'email.subject': emailPayload.subject,
    });

    try {
      logger.info('Sending email', {
        notificationId,
        to: emailPayload.to,
        subject: emailPayload.subject,
      });

      // Use circuit breaker to send email
      await sendEmailWithCircuitBreaker({
        to: emailPayload.to,
        from: emailPayload.from,
        subject: emailPayload.subject,
        html: emailPayload.html,
        text: emailPayload.text,
      });

      // Track successful delivery
      const duration = endTimer();
      metrics.trackNotificationDelivery(
        NotificationChannel.EMAIL,
        'success',
        'sendgrid',
        duration
      );

      addSpanEvent('email-sent-success', {
        'notification.id': notificationId,
        'duration.seconds': duration.toString(),
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

      logger.info('Email sent successfully', { notificationId, duration });
    } catch (error: any) {
      // Track failed delivery
      const duration = endTimer();
      metrics.trackNotificationDelivery(
        NotificationChannel.EMAIL,
        'failed',
        'sendgrid',
        duration
      );

      addSpanEvent('email-sent-failed', {
        'notification.id': notificationId,
        'error.message': error.message,
        'error.type': error.name,
      });

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

      // Re-throw to trigger DLQ retry logic
      throw error;
    }
  });
}

async function start() {
  try {
    // Start metrics server
    app.listen(METRICS_PORT, () => {
      logger.info(`Email Service metrics available on port ${METRICS_PORT}`);
    });

    // Update Kafka connection status
    metrics.updateKafkaConnectionStatus(true);

    await kafkaClient.subscribe(
      'email-service-group',
      ['channel.email.queued'],
      handleEmailQueue
    );

    logger.info('Email Service started and listening for events');
  } catch (error) {
    logger.error('Failed to start Email Service', { error });
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
