// IMPORTANT: Initialize tracing FIRST, before any other imports
import { initTracing } from '@notification-system/utils';
initTracing({
  serviceName: 'inapp-service',
  environment: process.env.NODE_ENV || 'development',
});

import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import { createLogger, KafkaClientWithDLQ } from '@notification-system/utils';
import { InAppPayload, NotificationChannel } from '@notification-system/types';
import { swaggerSpec, swaggerUiOptions } from './config/swagger.config';

dotenv.config();

const logger = createLogger('inapp-service');
const app = express();
const PORT = process.env.PORT || 3004;

app.use(cors());
app.use(express.json());

// API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));

// Raw OpenAPI spec endpoint
app.get('/api-docs.json', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Store active SSE connections
const connections = new Map<string, Response[]>();

// Initialize Kafka client with DLQ support
const kafkaClient = new KafkaClientWithDLQ(
  (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  'inapp-service',
  {
    enabled: true,
    maxRetries: 3,
    retryDelayMs: 1000,
    dlqTopicSuffix: '.dlq',
  }
);

/**
 * @swagger
 * /events/{userId}:
 *   get:
 *     tags:
 *       - Events
 *     summary: SSE stream for user notifications
 *     description: Establishes a Server-Sent Events connection for real-time notification delivery
 *     parameters:
 *       - name: userId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to receive notifications for
 *     responses:
 *       200:
 *         description: SSE connection established
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 */
app.get('/events/:userId', (req: Request, res: Response) => {
  const { userId } = req.params;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Add connection to user's connection list
  if (!connections.has(userId)) {
    connections.set(userId, []);
  }
  connections.get(userId)!.push(res);

  logger.info('SSE connection established', { userId });

  // Send initial connection success message
  res.write('data: ' + JSON.stringify({ type: 'connected' }) + '\\n\\n');

  // Handle client disconnect
  req.on('close', () => {
    const userConnections = connections.get(userId);
    if (userConnections) {
      const index = userConnections.indexOf(res);
      if (index > -1) {
        userConnections.splice(index, 1);
      }
      if (userConnections.length === 0) {
        connections.delete(userId);
      }
    }
    logger.info('SSE connection closed', { userId });
  });
});

// Handle in-app notifications from Kafka
async function handleInAppQueue(event: any): Promise<void> {
  const { data } = event;
  const { notificationId, payload } = data;
  const inAppPayload = payload as InAppPayload;

  try {
    logger.info('Sending in-app notification', {
      notificationId,
      userId: inAppPayload.userId,
    });

    // Get user connections
    const userConnections = connections.get(inAppPayload.userId);

    if (userConnections && userConnections.length > 0) {
      // Send to all active connections for this user
      const message = JSON.stringify({
        type: 'notification',
        id: notificationId,
        title: inAppPayload.title,
        message: inAppPayload.message,
        actionUrl: inAppPayload.actionUrl,
        iconUrl: inAppPayload.iconUrl,
        timestamp: new Date().toISOString(),
      });

      userConnections.forEach((connection) => {
        connection.write(`data: ${message}\\n\\n`);
      });

      await kafkaClient.publishEvent('inapp.sent', {
        type: 'channel.inapp.sent',
        data: {
          notificationId,
          channel: NotificationChannel.IN_APP,
        },
        timestamp: new Date(),
      });

      logger.info('In-app notification sent', {
        notificationId,
        connections: userConnections.length,
      });
    } else {
      logger.warn('No active connections for user', {
        notificationId,
        userId: inAppPayload.userId,
      });

      // User not connected - store for later retrieval
      await kafkaClient.publishEvent('delivery.failed', {
        type: 'delivery.failed',
        data: {
          notificationId,
          channel: NotificationChannel.IN_APP,
          error: 'User not connected',
        },
        timestamp: new Date(),
      });
    }
  } catch (error: any) {
    logger.error('Failed to send in-app notification', {
      notificationId,
      error: error.message,
    });

    await kafkaClient.publishEvent('delivery.failed', {
      type: 'delivery.failed',
      data: {
        notificationId,
        channel: NotificationChannel.IN_APP,
        error: error.message,
      },
      timestamp: new Date(),
    });
  }
}

async function start() {
  try {
    await kafkaClient.subscribe(
      'inapp-service-group',
      ['channel.inapp.queued'],
      handleInAppQueue
    );

    app.listen(PORT, () => {
      logger.info(`In-App Service listening on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start In-App Service', { error });
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down');
  await kafkaClient.disconnect();
  process.exit(0);
});

start();
